# RC Plane Flight Tracker

A fresh RC-plane weekly tracker built for Cloudflare Workers and Cloudflare D1. It does not use Supabase.

## Included in this starter

- Username-and-password registration and sign-in (no email address required).
- PBKDF2-HMAC-SHA256 password hashing with a per-user random salt.
- Hashed, HTTP-only, Secure, SameSite session cookies.
- Server-side authorization and same-origin checks for write requests.
- Basic registration and sign-in rate limits.
- Flight logging, recent history, and owner-only flight deletion.
- A 52-week calendar calculated from one shared start date.
- Completed weeks, missed weeks, current streak, and progress percentage.
- A public leaderboard with usernames and challenge statistics.
- An administrator settings panel for the challenge title, start date, and time zone.

The first version stores flight date, aircraft, duration, and notes. Photo evidence and password recovery are not included yet. Because accounts do not use email addresses, lost passwords currently need an administrator-assisted reset.

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

This creates the accounts, sessions, challenge settings, flights, and rate-limit tables.

Alternatively, open the D1 database's **Console** in Cloudflare and run the SQL in migrations/0001_initial.sql.

### 4. Deploy

Commit and push the repository to GitHub. Your connected Cloudflare Worker should build from the repository. If you deploy from a local terminal, run:

    npm run deploy

The Worker needs the D1 binding named **DB**. The static front end is served from public/ and API requests are routed through src/worker.js.

### 5. Create the first administrator

1. Open the deployed app and create your own account.
2. In the Cloudflare D1 Console, run the following query, replacing YOUR_USERNAME with your exact username:

    UPDATE users SET role = 'admin' WHERE username = 'YOUR_USERNAME';

3. Sign out and sign back in. The Challenge settings administrator panel will appear.

The administrator can set the challenge title, official start date, time zone, and active status. Choose the official start date before inviting participants.

## Challenge rules in this version

- The challenge has 52 consecutive seven-day windows (364 days).
- A week is completed when at least one logged flight has a date inside that week's date range.
- Multiple flights in a week still count as one completed week.
- An uncompleted week becomes missed after its final day has passed.
- Later weeks remain upcoming until their dates arrive.
- Flights outside the challenge period remain in the participant's flight history but do not complete a challenge week.
- The challenge time zone determines the current challenge date. Participants should enter the actual date of their flight.

The app is a record-keeping tool, not a reason to fly in poor conditions. Follow local field rules and suitable safety practices; skip a week whenever flying would not be safe or appropriate.

The application does not independently verify that a flight took place. The initial version trusts participant flight logs; photo evidence and administrator review can be added in a later stage.

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
- GET /api/leaderboard
- GET /api/admin/overview
- POST /api/admin/challenge
- GET /api/health

## Security notes

Passwords are never saved in plain text. The Worker uses PBKDF2-HMAC-SHA256 with 600,000 iterations and a random 16-byte salt. Session identifiers are random and only their SHA-256 hashes are stored in D1. Session cookies are HTTP-only, Secure, and SameSite=Strict.

The D1 binding must be configured before account features work. Do not place database credentials, private keys, or other secrets in front-end files or commit them to GitHub.
