# RC Plane Flight Journal

A private RC-plane flight logging app built for Cloudflare Workers and Cloudflare D1. It does not use Supabase.

This first version is a personal journal rather than a weekly flying challenge. It deliberately has no required flying quotas, missed-week penalties, streaks, or participant rankings. Never fly just to fill in a log or meet a target; follow local field rules and suitable conditions.

## Included

- Username-and-password registration and sign-in (no email address required); passwords must be 6–128 characters.
- PBKDF2-HMAC-SHA256 password hashing with a per-user random salt.
- Hashed, HTTP-only, Secure, SameSite session cookies.
- Server-side authorization and same-origin checks for write requests.
- Basic registration and sign-in rate limits.
- Flight logging with date, aircraft, duration, and notes.
- Personal flight history and total flight statistics.
- Owner-only flight deletion.

Photo uploads and password recovery are not included yet. Because accounts do not use email addresses, a lost password cannot currently be reset from the app.

## Cloudflare setup

The repository is configured for a Worker named `rc-plane`. The D1 database ID supplied for this project is already entered in `wrangler.jsonc`. The database binding is named `DB` and the database name is `rc-plane-tracker`.

### 1. Check the Worker Build settings

In the Cloudflare dashboard, open your **Worker → Settings → Build** (or **Builds → Build configuration**) and check:

- **Root directory:** leave it blank / repository root. The `wrangler.jsonc` file is at the repository root.
- **Build command:** leave blank; this app does not need a frontend build step.
- **Deploy command:** set to `npm run deploy`.

Do not configure this repository as a Pages static-site build. It is a Worker with static assets and an API. The deploy script explicitly points Wrangler at `wrangler.jsonc` and `./public/`, where the HTML, CSS, and browser JavaScript files live.

The Worker name in `wrangler.jsonc` is `rc-plane`; it must match the Worker connected to this GitHub repository.

### 2. Apply the D1 database migration

After confirming the D1 database exists with ID `51706583-1523-46a5-9116-58cc3f44be6d`, apply the schema once.

From a terminal in the repository, run:

    npm install
    npx wrangler d1 migrations apply rc-plane-tracker --remote --config ./wrangler.jsonc

Alternatively, open the D1 database's **Console** in Cloudflare and run the SQL in `migrations/0001_initial.sql`.

The migration creates the accounts, sessions, flights, and rate-limit tables.

### 3. Deploy

Push the repository to GitHub. With the Worker Build settings above, the connected Cloudflare deployment runs the `deploy` script:

    npm run deploy

For a local deployment from a terminal, first authenticate Wrangler with your Cloudflare account, then run the same command.

### 4. Verify the app

After a successful deployment, open the Worker URL and try creating an account. The app should let you sign in, add a flight record, view your personal statistics, and delete your own flight entries.

The API health endpoint is:

    /api/health

It should return a JSON response indicating that the D1 database is connected. If it reports that the tables are not ready, apply the migration from step 2.

## Local development

    npm install
    npm run db:migrate:local
    npm run dev

The local D1 database is separate from the remote production database.

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

Do not put passwords, API tokens, or other secrets in the repository. The D1 database ID is an identifier, not a database password.
