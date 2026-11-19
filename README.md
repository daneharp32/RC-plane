# RC Plane Flight Journal

A private, group-based RC-plane flight journal built for Cloudflare Workers and Cloudflare D1. It does not use Supabase.

## Included

- Username-and-password registration and sign-in (no email address required); passwords must be 6–128 characters.
- PBKDF2-HMAC-SHA256 password hashing with a per-user random salt.
- Hashed, HTTP-only, Secure, SameSite session cookies.
- Server-side authorization and same-origin checks for write requests.
- Login rate limiting.
- Flight-post composer with flying spot, one or more aircraft, completed flight date, required plane photo (including mobile camera-roll selection), and optional description.
- Community feed visible to signed-in users, with newest posts at the bottom and older posts loaded when scrolling upward.
- Personal flight-log view with totals and aircraft suggestions.
- Owner-specific account data and server-side validation.

The five built-in flying spots are Chill Guy, Unc Road, Sports Park, Shore Cliffs, and Other. Selecting Other requires a general place description. Please do not enter home or school addresses or other private location details.

Photos can be selected from a phone's camera roll or file picker. The browser attempts to decode the selected image, then repeatedly resizes and compresses it to JPEG before upload. The compressed photo is capped at about 315 KB so it fits safely within the current D1 post-row limit. R2 object storage can replace this approach later if the group needs larger images or a larger archive.

Photo uploads are mandatory for posts. Upload a photo of the RC aircraft from the completed session, and avoid photos showing other people's faces, vehicle plates, or private information. The journal is for recording flights that have already happened; it does not set flying quotas or streak goals. Follow local field rules and suitable conditions.

Password recovery is not included yet. Because accounts do not use email addresses, a lost password currently cannot be reset from the app.

## Cloudflare setup

The repository is configured for the existing Worker named \`flyers\`. The D1 binding is named \`DB\`, and it points to the database \`rc-plane-tracker\`.

The Worker creates the \`flight_posts\` table and its indexes automatically the first time the updated API is used. It also includes the repeatable SQL in \`migrations/0002_flight_posts.sql\` for reference and future migration-based setup. No manual database-console step should be needed for this new table.

### Worker build settings

In the Cloudflare dashboard, open **Flyers → Settings → Build** (or **Builds → Build configuration**) and use:

- **Root directory:** repository root / blank.
- **Build command:** blank.
- **Deploy command:** \`npm run deploy\`.

Do not configure this repository as a Pages static-site build. It is a Worker with static assets and an API. Wrangler is configured in \`wrangler.jsonc\` and serves browser files from \`public/\`.

### Deploy

Push to GitHub. Your connected Cloudflare Worker should start a new deployment. When it succeeds, open the Worker URL.

The health endpoint is:

    /api/health

It should return JSON indicating that D1 is connected and the schema is ready.

## Local development

    npm install
    npm run db:migrate:local
    npm run dev

The local D1 database is separate from the remote production database.

## API overview

- POST \`/api/auth/register\`
- POST \`/api/auth/login\`
- POST \`/api/auth/logout\`
- GET \`/api/me\`
- GET \`/api/dashboard\`
- POST \`/api/posts\`
- GET \`/api/feed\`
- GET \`/api/health\`

## Security notes

Passwords are never saved in plain text. The Worker uses PBKDF2-HMAC-SHA256 with 100,000 iterations and a random 16-byte salt. Session identifiers are random and only their SHA-256 hashes are stored in D1. Session cookies are HTTP-only, Secure, and SameSite=Strict.

All post and feed requests require a valid signed-in session. The feed does not expose email addresses, password data, or private account identifiers. The flying spot field uses named locations rather than GPS coordinates.

Do not put passwords, API tokens, or other secrets in the repository. The D1 database ID is an identifier, not a database password.
