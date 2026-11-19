# CampusVoice AI

CampusVoice AI keeps its existing React/Vite interface and serves it from Vercel. Vercel serverless API routes use Supabase Auth for identity, Supabase PostgreSQL with `pgvector` for persistent data, and Google Gemini for complaint analysis and semantic embeddings. Firebase and Neon are not used by the current application.

## Local setup

Use Node.js 20.19+ or 22.12+.

1. Copy `.env.example` to `.env.local` only if `.env.local` does not already exist. Add credentials locally without checking that file into Git.
2. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, and `GEMINI_API_KEY`.
3. Configure Supabase Auth email confirmation to match your desired signup flow. When confirmation is enabled, students must confirm their email and then sign in.
4. Run `npm run db:migrate` to create/upgrade the Supabase schema and verify the tables, RLS flags, and vector index.
5. Run `npm run dev` for the Vite UI. Vercel's local dev command is recommended when testing serverless `/api` routes locally.

`SUPABASE_SECRET_KEY`, database credentials, `GEMINI_API_KEY`, and `ADMIN_BOOTSTRAP_SECRET` are server-only. Never prefix them with `VITE_`, expose them to the browser, or commit `.env.local`.

## Supabase database connections

- `DATABASE_URL` is the serverless runtime PostgreSQL connection. Use the Supabase transaction pooler (normally port `6543`) and `sslmode=require`. The Node PostgreSQL client disables prepared statements for pooler compatibility and limits each function to one connection.
- `DATABASE_URL_MIGRATIONS` is optional and should be a direct or session-pooler connection (normally port `5432`) for schema changes. The migration command falls back to `DATABASE_URL` when it is absent.
- URL-encode special characters in the database password, especially `@`, `:`, `/`, `?`, `#`, and `%`.

The migration creates the departments, user profiles, complaints, Gemini analyses and embeddings, issue groups and members, status history, notifications, safeguarding cases, internal notes, management reports/actions, feedback, audit logs, and AI request tables. It enables `pgvector`, creates the cosine-similarity HNSW index, and installs the Auth profile trigger and role-aware RLS policies. The migration is idempotent and keeps its checksum in `app_schema_migrations`.

For an existing Neon deployment, this schema migration does not copy data. Export and import the old database separately after preparing Supabase Auth accounts and mapping each existing profile to an Auth user. Existing `password_hash` columns are not used for login and must not be exposed; existing complaint rows and their foreign keys are retained when the schema is applied to an already-populated database.

## Authentication and authorization

Student registration and login use Supabase Auth's server API. A database trigger creates each new student's application profile; public metadata cannot set an administrator role. Admin login uses the same Supabase Auth login flow. Provision the first administrator through the protected bootstrap endpoint using a locally generated `ADMIN_BOOTSTRAP_SECRET`, then disable/remove that bootstrap secret after setup.

The API stores Supabase access/refresh tokens in an `HttpOnly`, `SameSite=Lax` cookie, verifies access tokens with Supabase Auth, refreshes expired sessions, and reads authorization roles from the protected application profile. Admin roles are only assigned by the server bootstrap path. API queries enforce student ownership, administrator role, department scope, and safeguarding restrictions.

RLS is enabled on application data. Policies scope direct Supabase access by `auth.uid()` and the server-owned application role; sensitive safeguarding rows and audit data have narrower policies. The Vercel API connects through the PostgreSQL `postgres` database account, which bypasses RLS, so its server-side authorization checks are required and remain part of the trust boundary. Do not put database credentials or the Supabase secret key in frontend code.

The migration revokes broad table privileges from `anon` and `authenticated`, then grants scoped reads only. All writes go through the server API, which enforces role, department, ownership, and safeguarding rules; the Vercel database connection bypasses RLS, so server-side authorization remains mandatory.

## Gemini complaint intelligence

The API calls Google Gemini for validated structured complaint summaries, category, subcategory, priority, urgency, sentiment, safety review flags, explanations, and recommendations. It also creates 768-dimensional embeddings. Similar complaints are grouped by pgvector cosine distance; distinct student counts use unique profile IDs. If Gemini returns invalid data or is unavailable, submission fails explicitly and the complaint is not stored.

Configure `GEMINI_MODEL` and `GEMINI_EMBEDDING_MODEL` only if you need to change the defaults. Run `npm run test:gemini` to make live text-generation, structured-analysis, and embedding requests; the script does not write database records.

## Reports and exports

The management report endpoint calculates totals, distinct student counts, resolution rates, priorities, categories, departments, issue groups, and weekly trends from timestamped PostgreSQL records under the requesting administrator's scope. CSV/PDF downloads use that generated report rather than the browser's limited complaint list. Gemini management summaries are best-effort: if the model is unavailable, the report and exports still work and the UI indicates the summary is unavailable.

## Administrator bootstrap

Create the first administrator using a one-time POST to `/api/admin/bootstrap`. Send `x-admin-bootstrap-secret: <ADMIN_BOOTSTRAP_SECRET>` and a JSON body containing `name`, `email`, a strong `password`, `role`, and, for department administrators, `department`. This endpoint provisions an Auth account and assigns its role in the database. Keep the bootstrap secret private and rotate/remove it after provisioning.

## Vercel deployment

Configure these server environment variables in the Vercel project (Development/Preview/Production as appropriate):

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (server only)
- `DATABASE_URL`
- `DATABASE_URL_MIGRATIONS` (recommended for migrations; not required at runtime)
- `GEMINI_API_KEY` (server only)
- `GEMINI_MODEL` (optional; default `gemini-3.5-flash-lite`)
- `GEMINI_EMBEDDING_MODEL` (optional; default `gemini-embedding-2`)
- `APP_URL` (the deployed origin, used for secure cookies and same-origin checks)
- `ADMIN_BOOTSTRAP_SECRET` (only while provisioning the first admin)

Run the database migration from a trusted local environment with the migration URL. Deploy with Vercel after setting all required variables. `vercel.json` directs the Vite SPA to `index.html`; native Vercel API routes under `api/` are not rewritten back into themselves.

## Validation

```powershell
npm test
npm run lint
npm run build
npm run db:migrate
npm run test:gemini
```

Successful unit/build checks do not prove cloud access. Report live Supabase or Gemini success only after the configured service responds and the corresponding operation has been verified.

Credentials previously shared in chat should be rotated in Supabase and Google AI Studio before production use. Enter only the newly rotated values in the ignored local `.env.local` file or Vercel's encrypted environment settings; do not send them in chat or commit them.
