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
- Participants directory with completed challenge-week counts, profile pictures, usernames, and Hangar summaries.
- Per-user Hangars where members list aircraft they own, with optional photos and descriptions.
- Account settings for changing a username and profile picture.
- Multiple private groups: create a group or join one using its invite code.
- Group owners choose the group name and participant limit, can regenerate invite codes, share administrator access, and transfer ownership.
- Group admins can moderate group posts, manage the optional challenge, and remove regular members from their group.
- Group-specific feeds, participants, Hangars, and 360-day challenge settings. Accounts can belong to one group at a time.
- An optional 360-day calendar window; weeks are counted as seven-day blocks with at least one logged completed session. The app does not set flight quotas or missed-week penalties.
- Owner-specific account data and server-side validation.

The five built-in flying spots are Chill Guy, Unc Road, Sports Park, Shore Cliffs, and Other. Selecting Other requires a general place description. Please do not enter home or school addresses or other private location details.

Photos can be selected from a phone's camera roll or file picker. Flight-log photos are resized to about 315 KB, profile pictures to about 110 KB, and Hangar aircraft photos to about 130 KB before being stored as JPEG data in D1. Each account can list up to 30 Hangar aircraft. R2 object storage can replace this approach later if the group needs larger images or a larger archive.

Photo uploads are mandatory for posts. Upload a photo of the RC aircraft from the completed session, and avoid photos showing other people's faces, vehicle plates, or private information. The journal is for recording flights that have already happened; it does not set flying quotas or streak goals. Follow local field rules and suitable conditions.

Password recovery is not included yet. Because accounts do not use email addresses, a lost password currently cannot be reset from the app.

## Cloudflare setup

The repository is configured for the existing Worker named \`flyers\`. The D1 binding is named \`DB\`, and it points to the database \`rc-plane-tracker\`.

The Worker automatically creates the flight_posts, user_moderation, challenge_settings, user_profiles, hangar_planes, groups, group_members, group_bans, group_challenge_settings, and app_migrations tables and their indexes when the API is first used. It also adds the group_id column to flight_posts when needed. Repeatable SQL is included in migrations/0002_flight_posts.sql through migrations/0005_groups.sql. No manual database-console step is needed for these tables or the group column.

On the first API request after the group update, the Worker automatically creates a group named **Flyers** for every account that already exists. The account with the exact username `Dane` becomes the group owner; all other existing accounts join as members. Existing flight posts are assigned to Flyers, and the previous challenge dates are copied into Flyers' group challenge settings. Existing profiles and Hangar entries remain attached to the same accounts. This is a one-time migration and does not change anyone's password or delete existing posts.

### Worker build settings

In the Cloudflare dashboard, open **Flyers → Settings → Build** (or **Builds → Build configuration**) and use:

- **Root directory:** repository root / blank.
- **Build command:** blank.
- **Deploy command:** \`npm run deploy\`.

Do not configure this repository as a Pages static-site build. It is a Worker with static assets and an API. Wrangler is configured in \`wrangler.jsonc\` and serves browser files from \`public/\`.

### Groups and administrator access

A signed-in account can create a group or join one with its invite code. Each account belongs to one group at a time. When a new group is created, its creator becomes the owner and receives administrator access.

The owner can:
- Change the group name and maximum participant count (2–100 for newly created groups).
- Share the invite code or regenerate it, which invalidates the previous code.
- Promote members to administrators or remove administrator access.
- Transfer group ownership to another participant. The previous owner becomes an administrator.

Group owners and administrators can delete posts, start/end the optional 360-day group challenge, and kick members. Administrators can kick regular members; only the owner can remove another administrator. A kick removes group membership and blocks that account from rejoining that same group with its invite code. It does not delete the account, posts, or personal Hangar. The owner can restore a removed account's ability to join again; they must then use the current invite code.

Administrator access is based on the account's role in its current group, not on the username. The legacy `Dane` username rule has been removed. The existing exact username `Dane` is assigned as the owner of the initial **Flyers** group during the one-time migration.

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

- POST /api/auth/register and POST /api/auth/login
- GET /api/me
- GET /api/group
- POST /api/groups/create and POST /api/groups/join
- POST /api/group/leave, /api/group/settings, /api/group/invite-code, and /api/group/transfer
- POST /api/group/members/:id/role, /api/group/members/:id/kick, and /api/group/bans/:id/restore
- GET /api/dashboard
- POST /api/posts and GET /api/feed
- GET /api/challenge and GET /api/participants
- GET /api/hangar and POST /api/hangar
- DELETE /api/hangar/:id
- GET /api/settings and POST /api/settings
- GET /api/admin/overview (group administrator only)
- POST /api/admin/challenge/start and /api/admin/challenge/end (group administrator only)
- DELETE /api/admin/posts/:id and POST /api/admin/users/:id/kick (group administrator only)
- GET /api/health

## Security notes

Passwords are never saved in plain text. The Worker uses PBKDF2-HMAC-SHA256 with 100,000 iterations and a random 16-byte salt. Session identifiers are random and only their SHA-256 hashes are stored in D1. Session cookies are HTTP-only, Secure, and SameSite=Strict.

All journal and group data requests require a signed-in session and current group membership. The Worker scopes feeds, participants, Hangars, admin actions, and challenge settings to the signed-in user's group. Group roles are checked server-side; hiding a control in the browser is not the security boundary. A kicked account retains its login and personal data but cannot access that group until the owner restores its eligibility and it joins again. The feed does not expose email addresses, password data, or private account identifiers. The flying spot field uses named locations rather than GPS coordinates.

Do not put passwords, API tokens, or other secrets in the repository. The D1 database ID is an identifier, not a database password.
