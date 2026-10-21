// Runs before every test file. Tests must never touch real Google APIs or Redis.
process.env.NODE_ENV = "test";
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_REDIRECT_URI = "http://localhost:5000/google/callback";
process.env.GOOGLE_OAUTH_SCOPES =
  "openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/spreadsheets";
process.env.GOOGLE_CALENDAR_TIMEZONE = "UTC";
process.env.GOOGLE_DEFAULT_CALENDAR_ID = "primary";

delete process.env.GOOGLE_ACCESS_TOKEN;
delete process.env.GOOGLE_REFRESH_TOKEN;
delete process.env.REDIS_URL;
delete process.env.REDIS_API_KEY;
delete process.env.AIRTABLE_PAT;
delete process.env.AIRTABLE_API_KEY;
delete process.env.AIRTABLE_ACCESS_TOKEN;
delete process.env.CLICKUP_API_TOKEN;
delete process.env.CLICKUP_PERSONAL_TOKEN;
delete process.env.NOTION_API_TOKEN;
delete process.env.NOTION_TOKEN;
delete process.env.NOTION_API_KEY;
delete process.env.NOTION_VERSION;
