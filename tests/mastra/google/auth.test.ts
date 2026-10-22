import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockGoogleFetch } from "../../helpers/http";
import {
  getStoredGoogleAccount,
  resetFakeGoogleStore,
  seedGoogleAccount,
  setDefaultGoogleAccount,
} from "../../helpers/fake-google-store";
import { GoogleAuthError, resolveGoogleAccessToken } from "../../../src/mastra/tools/google/google-auth";

vi.mock("../../../src/mastra/tools/google/google-store", () => import("../../helpers/fake-google-store"));

const baseAccount = {
  email: "user@example.com",
  refreshToken: "stored-refresh-token",
  updatedAt: new Date().toISOString(),
};

function seedExpiredAccount() {
  seedGoogleAccount({
    ...baseAccount,
    accessToken: "expired-token",
    accessTokenExpiresAt: Date.now() - 5_000,
  });
}

describe("google auth", () => {
  beforeEach(async () => {
    resetFakeGoogleStore();
    delete process.env.GOOGLE_ACCESS_TOKEN;
    delete process.env.GOOGLE_REFRESH_TOKEN;
    await setDefaultGoogleAccount("user@example.com");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws with a connect hint when nothing is configured", async () => {
    await expect(resolveGoogleAccessToken()).rejects.toThrow(GoogleAuthError);
    await expect(resolveGoogleAccessToken()).rejects.toThrow("/google/connect");
  });

  it("reuses a valid stored access token without calling Google", async () => {
    seedGoogleAccount({
      ...baseAccount,
      accessToken: "stored-token",
      accessTokenExpiresAt: Date.now() + 3_600_000,
    });

    const { fetchMock } = mockGoogleFetch(() => jsonResponse({ error: "should not be called" }, 500));

    await expect(resolveGoogleAccessToken()).resolves.toBe("stored-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and writes it back to the store", async () => {
    seedExpiredAccount();

    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ access_token: "fresh-token", expires_in: 3600, token_type: "Bearer" }),
    );

    await expect(resolveGoogleAccessToken()).resolves.toBe("fresh-token");

    expect(calls).toHaveLength(1);
    expect(calls[0].url.origin).toBe("https://oauth2.googleapis.com");
    expect(calls[0].url.pathname).toBe("/token");

    const form = new URLSearchParams(calls[0].body);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("stored-refresh-token");
    expect(form.get("client_id")).toBe("test-client-id");
    expect(form.get("client_secret")).toBe("test-client-secret");

    const stored = getStoredGoogleAccount("user@example.com");
    expect(stored?.accessToken).toBe("fresh-token");
    expect(stored?.accessTokenExpiresAt).toBeGreaterThan(Date.now());
    expect(stored?.refreshToken).toBe("stored-refresh-token");
  });

  it("persists a rotated refresh token", async () => {
    seedExpiredAccount();

    mockGoogleFetch(() =>
      jsonResponse({
        access_token: "fresh-token",
        refresh_token: "rotated-refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    );

    await resolveGoogleAccessToken();

    expect(getStoredGoogleAccount("user@example.com")?.refreshToken).toBe("rotated-refresh-token");
  });

  it("deduplicates concurrent refreshes", async () => {
    seedExpiredAccount();

    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ access_token: "fresh-token", expires_in: 3600, token_type: "Bearer" }),
    );

    const tokens = await Promise.all([
      resolveGoogleAccessToken(),
      resolveGoogleAccessToken(),
      resolveGoogleAccessToken(),
    ]);

    expect(tokens).toEqual(["fresh-token", "fresh-token", "fresh-token"]);
    expect(calls).toHaveLength(1);
  });

  it("targets the account named in the request context", async () => {
    seedGoogleAccount({
      ...baseAccount,
      accessToken: "default-token",
      accessTokenExpiresAt: Date.now() + 3_600_000,
    });
    seedGoogleAccount({
      email: "other@example.com",
      refreshToken: "other-refresh",
      accessToken: "other-token",
      accessTokenExpiresAt: Date.now() + 3_600_000,
      updatedAt: new Date().toISOString(),
    });

    const context = {
      requestContext: {
        get: (key: string) => (key === "googleAccount" ? "other@example.com" : undefined),
      },
    } as never;

    await expect(resolveGoogleAccessToken(context)).resolves.toBe("other-token");
  });

  it("fails clearly when the stored account has no refresh token", async () => {
    seedGoogleAccount({
      email: "user@example.com",
      accessToken: "expired-token",
      accessTokenExpiresAt: Date.now() - 5_000,
      updatedAt: new Date().toISOString(),
    });

    await expect(resolveGoogleAccessToken()).rejects.toThrow("no refresh token");
  });

  it("surfaces refresh failures with a reconnect hint", async () => {
    seedExpiredAccount();

    mockGoogleFetch(() =>
      jsonResponse({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400),
    );

    await expect(resolveGoogleAccessToken()).rejects.toThrow(/revoked|reconnect/i);
  });

  it("uses GOOGLE_ACCESS_TOKEN when no account is stored", async () => {
    resetFakeGoogleStore();
    process.env.GOOGLE_ACCESS_TOKEN = "static-token";

    const { fetchMock } = mockGoogleFetch(() => jsonResponse({ error: "unexpected" }, 500));

    vi.resetModules();
    const { resolveGoogleAccessToken: resolve } = await import(
      "../../../src/mastra/tools/google/google-auth"
    );

    await expect(resolve()).resolves.toBe("static-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to GOOGLE_REFRESH_TOKEN from the environment", async () => {
    resetFakeGoogleStore();
    process.env.GOOGLE_REFRESH_TOKEN = "env-refresh-token";

    const { calls } = mockGoogleFetch(() =>
      jsonResponse({ access_token: "env-access-token", expires_in: 3600, token_type: "Bearer" }),
    );

    vi.resetModules();
    const { resolveGoogleAccessToken: resolve } = await import(
      "../../../src/mastra/tools/google/google-auth"
    );

    await expect(resolve()).resolves.toBe("env-access-token");
    expect(new URLSearchParams(calls[0].body).get("refresh_token")).toBe("env-refresh-token");

    delete process.env.GOOGLE_REFRESH_TOKEN;
  });
});
