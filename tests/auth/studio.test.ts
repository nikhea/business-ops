import { describe, expect, it, vi } from "vitest";
import { sign } from "jsonwebtoken";

// The real loader reads Postgres; keep this test to the JWT plumbing.
vi.mock("../../src/auth/users", () => ({
  loadUser: async (id: string) =>
    id === "user-1"
      ? { id: "user-1", email: "admin@example.com", name: "Admin", role: "admin", image: null }
      : null,
}));

import type { Principal } from "../../src/auth/index";
import {
  getStudioAuth,
  mintStudioToken,
  resolveStudioToken,
  studioJwtSecret,
} from "../../src/auth/studio";

const admin: Principal = {
  id: "user-1",
  email: "admin@example.com",
  name: "Admin",
  role: "admin",
};

describe("Studio JWT auth", () => {
  it("mints a token the Studio provider accepts", async () => {
    const token = mintStudioToken(admin);
    const payload = await getStudioAuth().authenticateToken(token);

    expect(payload.sub).toBe(admin.id);
    expect(payload.email).toBe(admin.email);
  });

  it("resolves a token to the live user row", async () => {
    const principal = await resolveStudioToken(mintStudioToken(admin));

    expect(principal?.id).toBe(admin.id);
    expect(principal?.role).toBe("admin");
  });

  it("rejects a token for a deleted user", async () => {
    const token = mintStudioToken({ ...admin, id: "user-deleted" });
    expect(await resolveStudioToken(token)).toBeNull();
  });

  it("rejects tokens signed with another secret", async () => {
    const token = sign({ sub: admin.id }, "not-the-studio-secret", {
      issuer: "business-ops",
      audience: "mastra-studio",
      expiresIn: "1h",
    });

    expect(await resolveStudioToken(token)).toBeNull();
  });

  it("rejects tokens from another issuer", async () => {
    const token = sign({ sub: admin.id }, studioJwtSecret(), {
      issuer: "someone-else",
      audience: "mastra-studio",
      expiresIn: "1h",
    });

    expect(await resolveStudioToken(token)).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const token = sign({ sub: admin.id }, studioJwtSecret(), {
      issuer: "business-ops",
      audience: "mastra-studio",
      expiresIn: -1,
    });

    expect(await resolveStudioToken(token)).toBeNull();
  });

  it("ignores API keys", async () => {
    expect(await resolveStudioToken("ops_abcdef123456")).toBeNull();
  });
});
