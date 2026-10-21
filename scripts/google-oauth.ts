#!/usr/bin/env bun
/**
 * Google OAuth helper.
 *
 * The consent flow is served by the app itself (src/routes/google.ts), so no
 * second listener is needed. Start the server, then open the printed URL.
 *
 * Usage:
 *   bun run google:auth              # print the consent URL
 *   bun run google:auth -- --force   # print the URL with consent forced (new refresh token)
 *   bun run google:auth -- --list    # list accounts already stored in Redis
 */

import { closeRedisClient, getDefaultGoogleAccount, listGoogleAccounts } from "../src/mastra/tools/google/google-redis";

const args = process.argv.slice(2);
const baseUrl =
  process.env.OPS_BASE_URL?.trim() ||
  `http://localhost:${process.env.PORT?.trim() || process.env.MASTRA_PORT?.trim() || 5000}`;

const connectUrl = new URL("/google/connect", baseUrl);
if (args.includes("--force")) connectUrl.searchParams.set("force", "true");

const emailIndex = args.indexOf("--email");
if (emailIndex !== -1 && args[emailIndex + 1]) {
  connectUrl.searchParams.set("email", args[emailIndex + 1]);
}

if (args.includes("--list")) {
  try {
    const [accounts, defaultAccount] = await Promise.all([listGoogleAccounts(), getDefaultGoogleAccount()]);

    if (accounts.length === 0) {
      console.log("No Google accounts are stored in Redis yet.");
    } else {
      console.log(`Connected Google accounts (${accounts.length}):`);
      for (const account of accounts) {
        const marker = account.email === defaultAccount ? " (default)" : "";
        const refresh = account.refreshToken ? "refresh token stored" : "no refresh token";
        console.log(`- ${account.email}${marker} — ${refresh}, updated ${account.updatedAt}`);
      }
    }
  } catch (error) {
    console.error("Could not read Redis:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await closeRedisClient();
  }
} else {
  console.log("Start the app first:  bun run dev");
  console.log("Then open:            " + connectUrl.toString());
  console.log("\nGoogle redirects back to GOOGLE_REDIRECT_URI and the account is saved in Redis.");
  console.log("Use --list to inspect stored accounts or --force to force a new consent.");
}
