# SmartHub

SmartHub is a multi-company operations workspace for finance, projects, EHS, HR, fleet, and team requests.

## Deploying to Vercel

Connect this repository to a Vercel project and configure its environment variables before the first production deployment:

- `DATABASE_URL` — Supabase Postgres transaction-pooler connection string. Keep this server-only.
- `BETTER_AUTH_SECRET` — a strong, private authentication secret.
- `BETTER_AUTH_URL` — the deployed app's full HTTPS origin.
- `VITE_PUBLIC_SUPABASE_URL` — Supabase project URL.
- `VITE_PUBLIC_SUPABASE_ANON_KEY` — Supabase public anon key; never put a service-role key here.
- `RESEND_API_KEY` and `EMAIL_FROM` — optional email delivery settings.

The production build runs the SQL migrations in `migrations/` against `DATABASE_URL`. Back up the database before production schema changes. Do not use a production database URL in Preview deployments.

## Local development

Install dependencies with `npm install`, configure local environment variables, then run `npm run dev`. Use a development database for local work. `npm run typecheck` checks TypeScript without connecting to the database.

## Security notes

Never commit `.env` files, database credentials, private API keys, customer documents, or screenshots containing business data. `.gitignore` excludes local environment files and workspace-only documents.
