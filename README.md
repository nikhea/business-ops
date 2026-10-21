# Bussiness Ops

A Mastra server for business operations. It exposes provider tools over HTTP and
serves an OpenAPI spec plus Swagger UI.

The project currently includes tool groups for Google Workspace, Airtable,
ClickUp, Notion, and Resend.

## Requirements

- [Bun](https://bun.sh/) 1.2 or newer
- A Redis connection for Google account storage and OAuth state
- API credentials for the providers you want to use

## Setup

```sh
bun install
```

Create a `.env` file in the project root. Only configure the providers you need:

```dotenv
# Server
PORT=5000

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

# Redis (required for the Google OAuth flow)
REDIS_URL=redis://localhost:6379

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
```

`.env` contains secrets. Keep it out of commits.

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

Connected Google accounts are stored in Redis and refreshed automatically.

## Running

```sh
bun run dev
```

The server starts on `http://localhost:5000` by default.

- Swagger UI: `http://localhost:5000/swagger-ui`
- OpenAPI spec: `http://localhost:5000/api/openapi.json`

Use `PORT` to change the port.

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

### Per-request credentials

Every provider supports a Request Context override instead of environment
credentials. This is useful for multi-tenant deployments:

| Provider | Context keys |
| --- | --- |
| Google | `googleAccessToken`, `googleAccount` / `googleEmail` |
| Airtable | `airtableAccessToken`, `airtableToken` |
| ClickUp | `clickupAccessToken`, `clickupToken` |
| Notion | `notionAccessToken`, `notionToken` |
| Resend | `resendApiKey`, `resendToken` |

## Project Layout

```text
src/
  index.ts                 HTTP server, Swagger UI, Google OAuth routes
  routes/google.ts         Google OAuth connect and callback
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
tests/                     Vitest tests and fetch mocks
scripts/google-oauth.ts    Google OAuth helper CLI
```

## Storage

Mastra uses local SQLite (`mastra.db`) and DuckDB files by default. To use a
hosted Turso database, set:

```dotenv
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
```

Local database files and `.mastra/` build output are ignored by Git.
