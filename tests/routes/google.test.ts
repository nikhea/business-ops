import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { jsonResponse, mockGoogleFetch } from "../helpers/http";
import {
  getStoredGoogleAccount,
  oauthStates,
  resetFakeGoogleStore,
  seedGoogleAccount,
  setDefaultGoogleAccount,
} from "../helpers/fake-google-redis";
import { googleOAuthRoutes } from "../../src/routes/google";

vi.mock("../../src/mastra/tools/google/google-redis", () => import("../helpers/fake-google-redis"));

const app = new Hono();
app.route("/google", googleOAuthRoutes);

function oauthFetch(options: { refreshToken?: string } = {}) {
  return mockGoogleFetch(({ url }) => {
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
      return jsonResponse({
        access_token: "access-token",
        ...(options.refreshToken === "" ? {} : { refresh_token: options.refreshToken ?? "refresh-token" }),
        expires_in: 3600,
        scope: "openid email https://www.googleapis.com/auth/gmail.modify",
        token_type: "Bearer",
      });
    }

    if (url.pathname === "/oauth2/v3/userinfo") {
      return jsonResponse({
        email: "user@example.com",
        name: "Test User",
        picture: "https://example.com/avatar.png",
      });
    }

    return jsonResponse({ error: { message: `unexpected ${url.pathname}` } }, 404);
  });
}

async function startConnect(query = ""): Promise<{ state: string; authUrl: URL }> {
  const response = await app.request(`/google/connect${query}`);
  const authUrl = new URL(response.headers.get("location") ?? "http://invalid");
  return { state: authUrl.searchParams.get("state") ?? "", authUrl };
}

describe("google oauth routes", () => {
  beforeEach(() => {
    resetFakeGoogleStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects /google/connect to Google with offline access", async () => {
    const response = await app.request("/google/connect");

    expect(response.status).toBe(302);

    const { state, authUrl } = await startConnect();
    expect(authUrl.origin + authUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(authUrl.searchParams.get("client_id")).toBe("test-client-id");
    expect(authUrl.searchParams.get("redirect_uri")).toBe("http://localhost:5000/google/callback");
    expect(authUrl.searchParams.get("response_type")).toBe("code");
    expect(authUrl.searchParams.get("access_type")).toBe("offline");
    expect(authUrl.searchParams.get("include_granted_scopes")).toBe("true");
    expect(authUrl.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/gmail.modify");
    expect(authUrl.searchParams.get("prompt")).toBeNull();
    expect(state).not.toBe("");
    expect(oauthStates.has(state)).toBe(true);
  });

  it("supports login hints and forced consent", async () => {
    const { authUrl } = await startConnect("?force=1&email=user%40example.com");

    expect(authUrl.searchParams.get("prompt")).toBe("consent");
    expect(authUrl.searchParams.get("login_hint")).toBe("user@example.com");
  });

  it("exchanges the code, stores the account, and makes it the default", async () => {
    const { state } = await startConnect();
    const { calls } = oauthFetch();

    const response = await app.request(`/google/callback?code=auth-code&state=${state}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Google account connected");
    expect(html).toContain("user@example.com");

    const tokenCall = calls.find((call) => call.url.hostname === "oauth2.googleapis.com");
    expect(tokenCall?.method).toBe("POST");
    const form = new URLSearchParams(tokenCall?.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("auth-code");
    expect(form.get("redirect_uri")).toBe("http://localhost:5000/google/callback");

    const stored = getStoredGoogleAccount("user@example.com");
    expect(stored?.refreshToken).toBe("refresh-token");
    expect(stored?.accessToken).toBe("access-token");
    expect(stored?.accessTokenExpiresAt).toBeGreaterThan(Date.now());
    expect(stored?.name).toBe("Test User");
    expect(stored?.scope).toContain("gmail.modify");

    const accountsResponse = await app.request("/google/accounts");
    const accounts = (await accountsResponse.json()) as { defaultAccount?: string };
    expect(accounts.defaultAccount).toBe("user@example.com");
  });

  it("rejects callbacks without a code", async () => {
    const response = await app.request("/google/callback?state=whatever");
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("missing the authorization code");
  });

  it("rejects unknown or replayed state values", async () => {
    const unknown = await app.request("/google/callback?code=auth-code&state=unknown");
    expect(unknown.status).toBe(400);

    const { state } = await startConnect();
    oauthFetch();

    const first = await app.request(`/google/callback?code=auth-code&state=${state}`);
    expect(first.status).toBe(200);

    const replay = await app.request(`/google/callback?code=auth-code&state=${state}`);
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("invalid or has expired");
  });

  it("asks for forced consent when Google omits a refresh token", async () => {
    const { state } = await startConnect();
    oauthFetch({ refreshToken: "" });

    const response = await app.request(`/google/callback?code=auth-code&state=${state}`);
    const html = await response.text();

    expect(response.status).toBe(409);
    expect(html).toContain("/google/connect?force=true");
    expect(getStoredGoogleAccount("user@example.com")).toBeUndefined();
  });

  it("keeps an existing refresh token when Google omits a new one", async () => {
    seedGoogleAccount({
      email: "user@example.com",
      refreshToken: "existing-refresh-token",
      accessTokenExpiresAt: Date.now() - 1_000,
      updatedAt: new Date().toISOString(),
    });

    const { state } = await startConnect();
    oauthFetch({ refreshToken: "" });

    const response = await app.request(`/google/callback?code=auth-code&state=${state}`);
    expect(response.status).toBe(200);
    expect(getStoredGoogleAccount("user@example.com")?.refreshToken).toBe("existing-refresh-token");
  });

  it("reports Google errors returned on the callback", async () => {
    const response = await app.request("/google/callback?error=access_denied");
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("access_denied");
  });

  it("lists accounts without leaking tokens", async () => {
    seedGoogleAccount({
      email: "user@example.com",
      name: "Test User",
      refreshToken: "secret-refresh-token",
      accessToken: "secret-access-token",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      scope: "openid email",
      updatedAt: new Date().toISOString(),
    });
    await setDefaultGoogleAccount("user@example.com");

    const response = await app.request("/google/accounts");
    const payload = (await response.json()) as {
      defaultAccount?: string;
      accounts: Record<string, unknown>[];
    };

    expect(response.status).toBe(200);
    expect(payload.defaultAccount).toBe("user@example.com");
    expect(payload.accounts).toHaveLength(1);
    expect(payload.accounts[0]).toMatchObject({
      email: "user@example.com",
      name: "Test User",
      isDefault: true,
      hasRefreshToken: true,
      scopes: ["openid", "email"],
    });

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("secret-refresh-token");
    expect(serialized).not.toContain("secret-access-token");
  });
});
