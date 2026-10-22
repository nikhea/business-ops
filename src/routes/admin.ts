/**
 * Admin API: user provisioning and provider credentials.
 *
 * Every route here is guarded by `requireAdminSession`.
 */

import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { betterAuthUrl } from "../config/env";
import { auth } from "../auth";
import { requireAdminSession } from "../auth/guards";
import { encryptSecret } from "../db/crypto";
import { getDb } from "../db";
import { providerCredential } from "../db/schema/app";

const PROVIDERS = ["airtable", "clickup", "notion", "resend", "hubspot"] as const;
type ProviderName = (typeof PROVIDERS)[number];

function isProvider(value: string): value is ProviderName {
  return (PROVIDERS as readonly string[]).includes(value);
}

export const adminRoutes = new Hono();

adminRoutes.use("*", requireAdminSession);

adminRoutes.get("/users", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
  const search = c.req.query("search")?.trim();

  const result = await auth.api.listUsers({
    query: {
      limit,
      offset,
      ...(search ? { searchValue: search, searchField: "email" as const } : {}),
    },
    headers: c.req.raw.headers,
  });

  return c.json({
    users: result.users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role ?? "user",
      banned: Boolean(user.banned),
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    })),
    total: result.total,
    limit,
    offset,
  });
});

adminRoutes.post("/users/invite", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    email?: string;
    name?: string;
    role?: string;
  } | null;

  const email = body?.email?.trim().toLowerCase();
  const name = body?.name?.trim();
  const requestedRole = body?.role?.trim() || "user";
  const role = requestedRole === "admin" ? "admin" : "user";

  if (!email || !email.includes("@")) {
    return c.json({ error: "A valid email is required." }, 400);
  }
  if (!name) {
    return c.json({ error: "A name is required." }, 400);
  }

  try {
    // The generated password is never shown to anyone: the invitee sets their
    // own password through the reset link below.
    const created = await auth.api.createUser({
      body: {
        email,
        name,
        role,
        password: randomBytes(24).toString("base64url"),
      },
      headers: c.req.raw.headers,
    });

    let emailSent = true;
    let warning: string | undefined;

    try {
      await auth.api.requestPasswordReset({
        body: {
          email,
          redirectTo: `${betterAuthUrl()}/accept-invite`,
        },
      });
    } catch (error) {
      // The account exists at this point. Report the delivery failure instead of
      // pretending the invite did not happen, so an admin can resend it.
      emailSent = false;
      warning = error instanceof Error ? error.message : String(error);
      console.error(`[admin] Invite email to ${email} failed:`, warning);
    }

    return c.json(
      {
        user: {
          id: created.user.id,
          email: created.user.email,
          name: created.user.name,
          role: created.user.role ?? role,
        },
        invited: true,
        emailSent,
        ...(warning ? { warning } : {}),
      },
      201,
    );
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

adminRoutes.post("/users/:id/resend-invite", async (c) => {
  const userId = c.req.param("id");

  const [user] = await auth.api
    .listUsers({ query: { limit: 1, filterField: "id", filterValue: userId }, headers: c.req.raw.headers })
    .then((result) => result.users);

  if (!user) return c.json({ error: "User not found." }, 404);

  try {
    await auth.api.requestPasswordReset({
      body: { email: user.email, redirectTo: `${betterAuthUrl()}/accept-invite` },
    });
    return c.json({ ok: true, email: user.email });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

adminRoutes.post("/users/:id/role", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { role?: string } | null;
  const role = body?.role?.trim();
  if (!role) return c.json({ error: "A role is required." }, 400);

  const userId = c.req.param("id");

  try {
    await auth.api.setRole({
      body: { userId, role: role as "admin" | "user" },
      headers: c.req.raw.headers,
    });
    return c.json({ ok: true, userId, role });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

adminRoutes.post("/users/:id/ban", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    reason?: string;
    expiresIn?: number;
  } | null;

  const userId = c.req.param("id");

  try {
    await auth.api.banUser({
      body: { userId, banReason: body?.reason, banExpiresIn: body?.expiresIn },
      headers: c.req.raw.headers,
    });
    return c.json({ ok: true, userId, banned: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

adminRoutes.post("/users/:id/unban", async (c) => {
  const userId = c.req.param("id");

  try {
    await auth.api.unbanUser({ body: { userId }, headers: c.req.raw.headers });
    return c.json({ ok: true, userId, banned: false });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

adminRoutes.get("/credentials", async (c) => {
  const rows = await getDb().select().from(providerCredential);

  return c.json({
    credentials: PROVIDERS.map((provider) => {
      const row = rows.find((item) => item.provider === provider);
      return {
        provider,
        configured: Boolean(row),
        updatedAt: row?.updatedAt ?? null,
        metadata: row?.metadata ?? null,
      };
    }),
  });
});

adminRoutes.put("/credentials/:provider", async (c) => {
  const provider = c.req.param("provider");
  if (!isProvider(provider)) {
    return c.json({ error: `Unknown provider "${provider}".`, providers: PROVIDERS }, 400);
  }

  const body = (await c.req.json().catch(() => null)) as {
    token?: string;
    metadata?: Record<string, unknown>;
  } | null;

  const token = body?.token?.trim();
  if (!token) return c.json({ error: "A token is required." }, 400);

  const encrypted = encryptSecret(token);
  const now = new Date();

  await getDb()
    .insert(providerCredential)
    .values({
      provider,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      metadata: body?.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: providerCredential.provider,
      set: {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        metadata: body?.metadata ?? null,
        updatedAt: now,
      },
    });

  return c.json({ ok: true, provider, configured: true });
});

adminRoutes.delete("/credentials/:provider", async (c) => {
  const provider = c.req.param("provider");
  if (!isProvider(provider)) {
    return c.json({ error: `Unknown provider "${provider}".` }, 400);
  }

  await getDb().delete(providerCredential).where(eq(providerCredential.provider, provider));

  return c.json({ ok: true, provider, configured: false });
});
