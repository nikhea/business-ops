# Bussiness Ops

A Mastra server for business operations. It exposes provider tools over HTTP and
serves an OpenAPI spec plus Swagger UI.

The project currently includes tool groups for Google Workspace, Airtable,
ClickUp, Notion, Resend, and HubSpot.

## Requirements

- [Bun](https://bun.sh/) 1.2 or newer
- PostgreSQL 14 or newer (auth, API keys, and provider credentials)
- API credentials for the providers you want to use

## Setup

```sh
bun install
```

Create a `.env` file in the project root. Only configure the providers you need:

```dotenv
# Server
PORT=5000
NODE_ENV=development

# PostgreSQL: use a dedicated database, not one shared with another app
DATABASE_URL=postgres://user:password@localhost:5432/business_ops
# Optional: where the embedded observability store lives (default mastra.duckdb)
# MASTRA_DUCKDB_PATH=mastra.duckdb

# Auth
BETTER_AUTH_URL=http://localhost:5000
BETTER_AUTH_SECRET=            # openssl rand -base64 32
CREDENTIAL_ENCRYPTION_KEY=     # openssl rand -base64 32 (keep separate from the auth secret)
# Optional sender for invite and password-reset emails
# AUTH_EMAIL_FROM="Business Ops <ops@your-domain.com>"

# Google Workspace
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:5000/google/callback
# Optional: comma- or space-separated scope override
# GOOGLE_OAUTH_SCOPES=
# Optional calendar defaults
# GOOGLE_DEFAULT_CALENDAR_ID=primary
# GOOGLE_CALENDAR_TIMEZONE=UTC
# Optional static token fallback instead of the OAuth flow
# GOOGLE_ACCESS_TOKEN=
# GOOGLE_REFRESH_TOKEN=

# Airtable
AIRTABLE_PAT=

# ClickUp
CLICKUP_API_TOKEN=

# Notion
NOTION_API_TOKEN=
# Optional; defaults to 2026-03-11
# NOTION_VERSION=2026-03-11

# Resend
RESEND_API_KEY=

# HubSpot
HUBSPOT_ACCESS_TOKEN=
# Optional; inferred automatically for pat-eu tokens
# HUBSPOT_BASE_URL=https://api-eu1.hubapi.com
```

`.env` contains secrets. It is ignored by Git; never commit it.

### Database

Generate and apply migrations, then create the first admin:

```sh
bun run db:generate      # after changing src/db/schema/*
bun run db:migrate
bun run admin:create -- --email you@example.com --name "Your Name" --password '...'
```

`DATABASE_URL` must include a database name and should point at a database
dedicated to this app. Better Auth owns the `user`, `session`, `account`,
`verification`, and `apikey` tables; the app adds `provider_credential`,
`google_account`, and `oauth_state`.


### Google OAuth

1. Create an OAuth client in Google Cloud Console.
2. Add `http://localhost:5000/google/callback` as an authorized redirect URI.
3. Enable the APIs for the tools you use: Gmail, Calendar, Drive, Sheets, Docs,
   and Meet.
4. Start the app and authorize an account:

```sh
bun run dev
bun run google:auth
```

Open the printed URL, or go directly to:

```text
http://localhost:5000/google/connect
```

Useful flags:

```sh
bun run google:auth -- --force          # force a new consent and refresh token
bun run google:auth -- --list           # list connected accounts
bun run google:auth -- --email you@example.com
```

Connected Google accounts and their refresh tokens are stored in Postgres,
encrypted with `CREDENTIAL_ENCRYPTION_KEY`, and refreshed automatically.

The `/google/connect` and `/google/accounts` routes require an admin session or
an admin API key.

## Authentication

The server uses [Better Auth](https://www.better-auth.com/) with email and
password. There is no self-signup: an admin creates each account.

- Sessions: HTTP-only cookies, 7 days, refreshed daily.
- API keys: `Authorization: Bearer ops_...` (or `?apiKey=`), created through
  Better Auth's API key endpoints.
- Scoping: Mastra memory and threads are keyed by `user:<id>` from the session,
  so one user cannot read another user's threads.

### Pages and endpoints

| Path | Purpose |
| --- | --- |
| `/signin` | Sign-in form |
| `/accept-invite` | Set a password from an invite link |
| `/auth/*` | Better Auth (`/auth/ok`, `/auth/sign-in/email`, `/auth/sign-out`, `/auth/api-key/*`, ...) |
| `/me` | Current principal |
| `/admin/users` | List users (admin) |
| `/admin/users/invite` | Create a user and email a password link (admin) |
| `/admin/users/:id/resend-invite` | Send a new password link (admin) |
| `/admin/users/:id/role` | Change role (admin) |
| `/admin/users/:id/ban` | Ban a user (admin) |
| `/admin/users/:id/unban` | Unban a user (admin) |
| `/admin/credentials` | List configured providers, never the values (admin) |
| `/admin/credentials/:provider` | Store or delete a provider token (admin) |

Better Auth is mounted at `/auth`, not `/api/auth`, because Mastra already owns
`/api/auth/*` (`capabilities`, `me`, `logout`, `refresh`, `sso`).

### Inviting a user

```sh
curl -X POST http://localhost:5000/admin/users/invite \
  -H 'content-type: application/json' \
  -H 'cookie: <admin session cookie>' \
  -d '{"email":"teammate@example.com","name":"Teammate","role":"user"}'
```

The account is created with a random password, then a password-reset link is
emailed. When `RESEND_API_KEY` is unset in development, the link is printed to
the server log instead.

### Provider credentials

Admins can move provider tokens out of `.env` and into Postgres:

```sh
curl -X PUT http://localhost:5000/admin/credentials/notion \
  -H 'content-type: application/json' \
  -H 'cookie: <admin session cookie>' \
  -d '{"token":"secret_..."}'
```

Supported providers: `airtable`, `clickup`, `notion`, `resend`, `hubspot`.
Values are encrypted with AES-256-GCM. A database value wins over the matching
environment variable; the tools fall back to `.env` when no row exists.

## Running

```sh
bun run dev
```

The server starts on `http://localhost:5000` by default. Set `BETTER_AUTH_URL`
to the same origin, otherwise cookies and invite links point at the wrong host.

- Sign in: `http://localhost:5000/signin`
- Swagger UI: `http://localhost:5000/swagger-ui`
- OpenAPI spec: `http://localhost:5000/api/openapi.json`

`/api/*`, `/admin/*`, `/google/*`, and `/swagger-ui/*` require a session or API
key. Use `PORT` to change the port.

Use `bun run dev` for the full server. `bun run start` boots only Mastra's own
server (`mastra dev`) and does not mount `/auth/*`, `/admin/*`, or `/signin`.


## Testing

```sh
bun run test
bun run test:watch
```

Tests are hermetic: provider HTTP calls are mocked, so they do not need real API
keys or make network requests.

## Tool Groups

Tools are defined in `src/mastra/tools/` and registered in
`src/mastra/index.ts`.

| Provider | Tools | Coverage |
| --- | ---: | --- |
| Google Workspace | 46 | Gmail, Calendar, Drive, Sheets, Docs, Meet |
| Airtable | 17 | Bases, tables, records, comments, webhooks |
| ClickUp | 34 | Workspace hierarchy, tasks, comments, time, custom fields, webhooks, checklists |
| Notion | 31 | Users, search, blocks, pages, databases, data sources, comments, Markdown |
| Resend | 50 | Emails, domains, contacts, segments, broadcasts, templates, webhooks, topics |
| HubSpot | 94 | Contacts, companies, deals, tickets, leads, quotes, orders, invoices, line items, custom objects, owners, pipelines, properties, associations, lists, conversations, forms, marketing events |

### Resend

Resend tools use the official `resend` SDK. Keys are read from
`RESEND_API_KEY`.

The email sending tools are:

- `resend_send_email`
- `resend_send_batch_emails`
- `resend_list_emails`
- `resend_get_email`
- `resend_update_email`
- `resend_cancel_email`

The remaining Resend tools manage domains, contacts, segments, broadcasts,
templates, webhooks, and topics.

**Key permissions matter.** A send-only Resend key can send email but returns
`401 restricted_api_key` for management endpoints. Create a full-access key if
you need domains, contacts, broadcasts, templates, webhooks, or topics.

Inspect tool schemas and invoke them through Swagger UI, or use the SDK
directly:

```ts
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: "onboarding@resend.dev",
  to: "you@example.com",
  subject: "Hello World",
  html: "<p>Congrats on sending your first email!</p>",
});
```

### HubSpot

HubSpot tools use the CRM and marketing APIs with a private app access token.
Set `HUBSPOT_ACCESS_TOKEN` to a token from
**Development → Legacy apps → your private app**.

The API host is inferred from the token prefix. Tokens starting with `pat-eu`
use `https://api-eu1.hubapi.com`; set `HUBSPOT_BASE_URL` to override it.

The current tool set covers:

- CRM objects: contacts, companies, deals, tickets, leads, quotes, orders,
  invoices, and line items
- Custom objects and object schemas
- Owners, pipelines, properties, and associations
- Lists and list memberships
- Conversations, forms, and marketing events

The private app needs read/write scopes for the objects you want to use. If
HubSpot returns `403 MISSING_SCOPES` for an object that is already enabled in
the app, rotate the private app token so the new scopes take effect.

### Per-request credentials

Every provider supports a Request Context override instead of environment
credentials. The server populates these keys from Postgres for each
authenticated request (see Provider credentials above); anything not stored there
falls back to `.env`.

| Provider | Context keys |
| --- | --- |
| Google | `googleAccessToken`, `googleAccount` / `googleEmail` |
| Airtable | `airtableAccessToken`, `airtableToken` |
| ClickUp | `clickupAccessToken`, `clickupToken` |
| Notion | `notionAccessToken`, `notionToken` |
| Resend | `resendApiKey`, `resendToken` |
| HubSpot | `hubspotAccessToken`, `hubspotToken` |

## Project Layout

```text
src/
  index.ts                 HTTP server, guards, Swagger UI, auth mount
  auth/                    Better Auth config, principal resolution, guards
  config/env.ts            Boot-time environment validation
  db/                      Postgres pool, Drizzle schema, AES-256-GCM helpers
  routes/
    admin.ts               User provisioning and provider credentials
    google.ts              Google OAuth connect and callback (admin only)
    pages.ts               /signin and /accept-invite
  mastra/
    index.ts               Mastra config and tool registration
    agents/                Agents
    workflows/             Workflows
    tools/
      google/              Google Workspace tools
      airtable/            Airtable tools
      clickup/             ClickUp tools
      notion/              Notion tools
      resend/              Resend tools
      hubspot/             HubSpot tools
drizzle/                   Generated SQL migrations
tests/                     Vitest tests and fetch mocks
scripts/google-oauth.ts    Google OAuth helper CLI
```

## Storage

Postgres (`DATABASE_URL`) holds everything except observability:

- Auth: `user`, `session`, `account`, `verification`, `apikey`
- App: `provider_credential`, `google_account`, `oauth_state`
- Mastra: `mastra_*` tables for memory threads, messages, workflow snapshots,
  and agents

Observability (traces, logs, metrics, scores, feedback) goes to an embedded
DuckDB file, `mastra.duckdb`, through a composite store. Override the path with
`MASTRA_DUCKDB_PATH`. DuckDB implements only the observability domain, so the
Postgres store remains the default for everything else.

Apply app migrations with `bun run db:migrate`. Mastra creates and migrates its
own `mastra_*` tables on startup. DuckDB is intended for local development; use
ClickHouse or another analytical backend for production traces.

No Redis or SQLite files are used. `mastra.duckdb*` and `.mastra/` build output
are ignored by Git.
