# RC Plane Flight Journal

A private RC-plane flight logging app built for Cloudflare Workers and Cloudflare D1. It does not use Supabase.

This first version is a personal journal rather than a weekly flying challenge. It deliberately has no required flying quotas, missed-week penalties, streaks, or participant rankings. Never fly just to fill in a log or meet a target; follow local field rules and suitable conditions.

## Included

- Username-and-password registration and sign-in (no email address required).
- PBKDF2-HMAC-SHA256 password hashing with a per-user random salt.
- Hashed, HTTP-only, Secure, SameSite session cookies.
- Server-side authorization and same-origin checks for write requests.
- Basic registration and sign-in rate limits.
- Flight logging with date, aircraft, duration, and notes.
- Personal flight history and total flight statistics.
- Owner-only flight deletion.

Photo uploads and password recovery are not included yet. Because accounts do not use email addresses, a lost password cannot currently be reset from the app.

## Cloudflare setup

The repository is configured for a Worker named rc-plane. If your existing Worker has a different name in Cloudflare, change the name field in wrangler.jsonc to match it.

### 1. Create the D1 database

In the Cloudflare dashboard, open **Storage & databases → D1 SQL Database** and create a database named **rc-plane-tracker**.

Copy its database ID. Alternatively, from a local terminal with Wrangler installed, run:

    npm install
    npx wrangler d1 create rc-plane-tracker

### 2. Connect the database to the Worker

Open wrangler.jsonc and replace **REPLACE_WITH_YOUR_D1_DATABASE_ID** with the database ID Cloudflare provided. The binding name must remain **DB**.

### 3. Apply the database migration

From a terminal in the repository, run:

    npm install
    npx wrangler d1 migrations apply rc-plane-tracker --remote

This creates the accounts, sessions, flights, and rate-limit tables.

Alternatively, open the D1 database's **Console** in Cloudflare and run the SQL in migrations/0001_initial.sql.

### 4. Deploy

Commit and push the repository to GitHub. Your connected Cloudflare Worker should build from the repository. If you deploy from a local terminal, run:

    npm run deploy

The Worker needs the D1 binding named **DB**. The static front end is served from public/ and API requests are routed through src/worker.js.

## Local development

    npm install
    npm run dev

For local development, Wrangler uses a local D1 database. Apply migrations locally with:

    npm run db:migrate:local

The local database is separate from the remote production database.

## API overview

- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/me
- GET /api/dashboard
- POST /api/flights
- DELETE /api/flights/:id
- GET /api/health

## Security notes

Passwords are never saved in plain text. The Worker uses PBKDF2-HMAC-SHA256 with 600,000 iterations and a random 16-byte salt. Session identifiers are random and only their SHA-256 hashes are stored in D1. Session cookies are HTTP-only, Secure, and SameSite=Strict.

The D1 binding must be configured before account features work. Do not place database credentials, private keys, or other secrets in front-end files or commit them to GitHub.
