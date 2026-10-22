/**
 * Minimal HTML pages so the app is usable without a frontend.
 *
 * Both pages post JSON to Better Auth's own endpoints; they do not implement
 * any auth logic themselves.
 */

import { Hono } from "hono";

export const pageRoutes = new Hono();

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only allow same-origin relative redirects. */
function safeNext(value: string | undefined): string {
  if (!value) return "/swagger-ui";
  if (!value.startsWith("/") || value.startsWith("//")) return "/swagger-ui";
  return value;
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: system-ui, -apple-system, sans-serif; max-width: 24rem; margin: 5rem auto; padding: 0 1.5rem; color: #1f2937; }
      h1 { font-size: 1.25rem; margin-bottom: 1.5rem; }
      label { display: block; font-size: 0.8125rem; font-weight: 600; margin: 1rem 0 0.35rem; }
      input { width: 100%; box-sizing: border-box; padding: 0.55rem 0.65rem; border: 1px solid #d1d5db; border-radius: 0.375rem; font: inherit; }
      button { width: 100%; margin-top: 1.5rem; padding: 0.6rem 1rem; border: 0; border-radius: 0.375rem; background: #2563eb; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
      button:disabled { opacity: 0.6; cursor: progress; }
      .error { color: #b91c1c; font-size: 0.875rem; min-height: 1.25rem; margin-top: 1rem; }
      .muted { color: #6b7280; font-size: 0.8125rem; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    ${body}
  </body>
</html>`;
}

pageRoutes.get("/signin", (c) => {
  const next = safeNext(c.req.query("next"));

  return c.html(
    layout(
      "Sign in to Business Ops",
      `<form id="form">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="username" required autofocus />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required />
        <button type="submit">Sign in</button>
        <p class="error" id="error" role="alert"></p>
        <p class="muted">Accounts are created by an admin. Use the link in your invite email to set a password.</p>
      </form>
      <script>
        const form = document.getElementById("form");
        const error = document.getElementById("error");
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          error.textContent = "";
          const button = form.querySelector("button");
          button.disabled = true;
          try {
            const response = await fetch("/auth/sign-in/email", {
              method: "POST",
              headers: { "content-type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({
                email: form.email.value,
                password: form.password.value,
              }),
            });
            if (!response.ok) {
              const body = await response.json().catch(() => ({}));
              error.textContent = body.message || "Sign-in failed.";
              return;
            }
            window.location.assign(${JSON.stringify(next)});
          } catch {
            error.textContent = "Could not reach the server.";
          } finally {
            button.disabled = false;
          }
        });
      </script>`,
    ),
  );
});

pageRoutes.get("/accept-invite", (c) => {
  const token = c.req.query("token") ?? "";
  const oauthError = c.req.query("error");
  const initialError =
    oauthError === "INVALID_TOKEN" ? "This invite link is invalid or has expired." : "";

  if (!token) {
    return c.html(
      layout(
        "Set your password",
        `<p class="muted">This page needs a valid invite link. Ask an admin to send a new one.</p>`,
      ),
      400,
    );
  }

  return c.html(
    layout(
      "Set your password",
      `<form id="form">
        <label for="password">New password</label>
        <input id="password" name="password" type="password" autocomplete="new-password" minlength="12" required autofocus />
        <label for="confirm">Confirm password</label>
        <input id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="12" required />
        <button type="submit">Set password</button>
        <p class="error" id="error" role="alert">${escapeHtml(initialError)}</p>
        <p class="muted">Use at least 12 characters.</p>
      </form>
      <script>
        const form = document.getElementById("form");
        const error = document.getElementById("error");
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          error.textContent = "";
          if (form.password.value !== form.confirm.value) {
            error.textContent = "The passwords do not match.";
            return;
          }
          const button = form.querySelector("button");
          button.disabled = true;
          try {
            const response = await fetch("/auth/reset-password", {
              method: "POST",
              headers: { "content-type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({
                newPassword: form.password.value,
                token: ${JSON.stringify(token)},
              }),
            });
            if (!response.ok) {
              const body = await response.json().catch(() => ({}));
              error.textContent = body.message || "Could not set the password.";
              return;
            }
            window.location.assign("/signin");
          } catch {
            error.textContent = "Could not reach the server.";
          } finally {
            button.disabled = false;
          }
        });
      </script>`,
    ),
  );
});
