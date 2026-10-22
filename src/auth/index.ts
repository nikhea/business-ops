/**
 * Better Auth instance.
 *
 * - Email + password only. Sign-up is disabled: users are provisioned by an
 *   admin, who triggers a password-reset link that doubles as the invite.
 * - Mounted at /auth, not /api/auth: Mastra already owns /api/auth/* for its
 *   own (unused here) auth endpoints.
 */

import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { admin, openAPI } from "better-auth/plugins";
import { betterAuthUrl } from "../config/env";
import { getDb } from "../db";
import * as authSchema from "../db/schema/auth";
import { sendPasswordResetEmail } from "./email";

export const auth = betterAuth({
  appName: "Business Ops",
  basePath: "/auth",
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: authSchema,
  }),
  emailAndPassword: {
    enabled: true,
    // Only admins create accounts, via POST /admin/users/invite.
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({ email: user.email, name: user.name, url });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  user: {
    changeEmail: { enabled: false },
    deleteUser: { enabled: false },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  trustedOrigins: [betterAuthUrl()],
  plugins: [
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
    apiKey({
      defaultPrefix: "ops_",
      enableMetadata: true,
    }),
    // Serves /auth/reference (Scalar UI) and /auth/open-api/generate-schema.
    openAPI(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
export type AuthUser = AuthSession["user"];

/** Shape we put on Mastra's request context and auth guards. */
export interface Principal {
  id: string;
  email: string;
  name: string;
  role: string;
  image?: string | null;
}
