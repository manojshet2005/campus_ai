# CAMPUSVOICE AI

CampusVoice AI is a Vite/React application with Vercel Serverless API routes, Neon PostgreSQL, Drizzle migrations, session authentication, and server-side Google Gemini integration.

## No Firebase or demo mode

Firebase code and configuration are removed. The application does not contain seeded accounts or records, browser database state, or simulated Gemini analysis. If database or Gemini configuration is missing, API routes return explicit service errors.

## Local setup

```powershell
npm install
copy .env.example .env.local
npm run dev
```

Set `DATABASE_URL` and `DATABASE_URL_UNPOOLED` to Neon pooler/direct connection strings. Set `GEMINI_API_KEY` only in server environment configuration; never use a `VITE_` Gemini variable.

Run the PostgreSQL schema migration:

```powershell
npm run db:migrate
```

The migration enables `pgvector`, creates the relational schema, constraints, indexes, embeddings, status history, safeguarding, notifications, reports, feedback and audit tables.

## Authentication

Public registration always creates a `student` account. Passwords use bcrypt with server-side validation. Sessions are random opaque tokens stored as SHA-256 hashes, expire after seven days, support revocation, and use HTTP-only, Secure (when deployed on HTTPS), SameSite=Lax cookies.

Administrator accounts must be provisioned directly in PostgreSQL or through a trusted administrative provisioning process. Public registration cannot assign an administrator role or department.

The API verifies the session and role on every request. Department administrators are constrained to their department and cannot access restricted safety complaints. Safeguarding officers can access safety-restricted cases. Management viewers are read-only.

## Gemini

The server uses `@google/genai` and `GEMINI_API_KEY`. `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`; `GEMINI_EMBEDDING_MODEL` defaults to `gemini-embedding-2`.

Before deployment, verify that both model names are enabled for the Google AI Studio key and account. Complaint submission requests structured analysis and a 768-dimensional embedding, validates strict Zod JSON, stores the original text unchanged, and writes analysis/embedding/status/notification records transactionally. Missing or invalid Gemini responses cause a visible 502 and no complaint is stored.

For a local live Gemini check, place the server key in the ignored `.env.local` file and run:

```powershell
npm run test:gemini
```

This performs real text, complaint-JSON, and embedding requests. It does not create database records.

## API routes

- `POST /api/auth/register` — student registration
- `POST /api/auth/login` — login
- `POST /api/auth/logout` — revoke session
- `GET /api/auth/session` — current session
- `GET /api/complaints` — role-scoped complaint retrieval
- `POST /api/complaints` — Gemini-analyzed student complaint submission
- `PATCH /api/complaints/:id` — authorised complaint assignment/status/response updates
- `POST /api/complaints/:id/feedback` — resolved-case student feedback
- `GET /api/analytics` — role-scoped database analytics
- `GET /api/notifications` — student notifications

## Vercel deployment

1. Create a Neon project and copy its pooled and direct connection strings.
2. Run `npm run db:migrate` locally using `DATABASE_URL_UNPOOLED`.
3. Import the project into Vercel and set:
   - `DATABASE_URL` — Neon pooled URL
   - `DATABASE_URL_UNPOOLED` — direct URL
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL=gemini-3.5-flash-lite`
   - `GEMINI_EMBEDDING_MODEL=gemini-embedding-2`
   - `APP_URL=https://YOUR-DOMAIN`
   - `ADMIN_BOOTSTRAP_SECRET`
4. Set each environment variable in Vercel Preview and Production as appropriate.
5. Deploy with `vercel --prod` or by connecting the repository.
6. Run a real registration, login, complaint submission, database read, Gemini model request, and admin status update before accepting the deployment.

## Validation

```powershell
npm test
npm run lint
npm run build
npm run db:migrate
```

No live database or Gemini request is claimed until credentials are supplied and verified.
