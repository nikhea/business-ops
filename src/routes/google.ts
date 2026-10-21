import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import {
  consumeOAuthState,
  getDefaultGoogleAccount,
  getGoogleAccount,
  listGoogleAccounts,
  normalizeEmail,
  saveGoogleAccount,
  saveOAuthState,
  setDefaultGoogleAccount,
} from "../mastra/tools/google/google-redis";

const DEFAULT_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/meetings.space.created",
  "https://www.googleapis.com/auth/meetings.space.readonly",
];

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface UserInfo {
  email?: string;
  name?: string;
  picture?: string;
}

export const googleOAuthRoutes = new Hono();

function getScopes(): string[] {
  const configured = process.env.GOOGLE_OAUTH_SCOPES?.trim();
  if (!configured) return DEFAULT_SCOPES;
  const scopes = configured.split(/[\s,]+/).filter(Boolean);
  return scopes.length > 0 ? scopes : DEFAULT_SCOPES;
}

function getRedirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI?.trim() ||
    `http://localhost:${process.env.PORT?.trim() || 5000}/google/callback`
  );
}

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.");
  }

  return { clientId, clientSecret };
}

async function exchangeCode(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = getCredentials();

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getRedirectUri(),
      grant_type: "authorization_code",
    }),
  });

  const tokens = (await response.json()) as TokenResponse;

  if (!response.ok || tokens.error) {
    throw new Error(
      tokens.error_description ?? tokens.error ?? `Token exchange failed (${response.status}).`,
    );
  }

  return tokens;
}

async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Could not read the Google profile (${response.status}).`);
  }

  return (await response.json()) as UserInfo;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 44rem; margin: 4rem auto; padding: 0 1.5rem; color: #1f2937; }
      code { background: #f3f4f6; padding: 0.1rem 0.35rem; border-radius: 0.25rem; }
      .error { color: #b91c1c; }
      a { color: #2563eb; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    ${body}
  </body>
</html>`;
}

function errorPage(message: string, status: number = 500) {
  return new Response(page("Google authorization failed", `<p class="error">${escapeHtml(message)}</p>`), {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

googleOAuthRoutes.get("/connect", async (c) => {
  try {
    const { clientId } = getCredentials();
    const state = randomUUID();
    await saveOAuthState(state);

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", getRedirectUri());
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", getScopes().join(" "));
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("include_granted_scopes", "true");

    const loginHint = c.req.query("email");
    if (loginHint) authUrl.searchParams.set("login_hint", loginHint);

    const force = (c.req.query("force") ?? "").toLowerCase();
    if (force === "1" || force === "true" || force === "consent") {
      authUrl.searchParams.set("prompt", "consent");
    }

    return c.redirect(authUrl.toString());
  } catch (error) {
    return errorPage(error instanceof Error ? error.message : String(error));
  }
});

googleOAuthRoutes.get("/callback", async (c) => {
  const oauthError = c.req.query("error");
  if (oauthError) {
    return errorPage(`Google returned an error: ${oauthError}`, 400);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return errorPage("The callback is missing the authorization code or state.", 400);
  }

  try {
    if (!(await consumeOAuthState(state))) {
      return errorPage("This authorization link is invalid or has expired. Start again at /google/connect.", 400);
    }

    const tokens = await exchangeCode(code);

    if (!tokens.access_token) {
      return errorPage("Google did not return an access token.", 400);
    }

    const profile = await fetchUserInfo(tokens.access_token);
    const email = normalizeEmail(profile.email ?? "");

    if (!email) {
      return errorPage("Google did not return an email address for this account.", 400);
    }

    const existing = await getGoogleAccount(email);

    if (!tokens.refresh_token && !existing?.refreshToken) {
      return new Response(
        page(
          "Almost there",
          `<p>Google authorized <strong>${escapeHtml(email)}</strong> but did not issue a refresh token, so the connection would expire in about an hour.</p>
           <p>Authorize again with consent forced: <a href="/google/connect?force=true&email=${encodeURIComponent(email)}">/google/connect?force=true</a></p>`,
        ),
        { status: 409, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    await saveGoogleAccount({
      email,
      name: profile.name,
      picture: profile.picture,
      refreshToken: tokens.refresh_token ?? existing?.refreshToken,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      scope: tokens.scope ?? existing?.scope,
      tokenType: tokens.token_type,
    });

    const isFirstAccount = !(await getDefaultGoogleAccount());
    if (isFirstAccount) {
      await setDefaultGoogleAccount(email);
    }

    return new Response(
      page(
        "Google account connected",
        `<p><strong>${escapeHtml(email)}</strong> is now stored in Redis${isFirstAccount ? " and set as the default account" : ""}.</p>
         <p>Refresh token saved: <strong>${tokens.refresh_token || existing?.refreshToken ? "yes" : "no"}</strong>. Tools will refresh access tokens automatically.</p>
         <p><a href="/google/accounts">View connected accounts</a></p>`,
      ),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  } catch (error) {
    return errorPage(error instanceof Error ? error.message : String(error));
  }
});

googleOAuthRoutes.get("/accounts", async (c) => {
  try {
    const [accounts, defaultAccount] = await Promise.all([listGoogleAccounts(), getDefaultGoogleAccount()]);

    return c.json({
      defaultAccount,
      accounts: accounts.map((account) => ({
        email: account.email,
        name: account.name,
        picture: account.picture,
        isDefault: account.email === defaultAccount,
        scopes: account.scope?.split(/\s+/).filter(Boolean) ?? [],
        hasRefreshToken: Boolean(account.refreshToken),
        accessTokenExpiresAt: account.accessTokenExpiresAt
          ? new Date(account.accessTokenExpiresAt).toISOString()
          : undefined,
        connectedAt: account.connectedAt,
        updatedAt: account.updatedAt,
      })),
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
