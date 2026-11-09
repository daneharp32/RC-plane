# FieldLog — RC Plane Weekly Challenge

A private, multi-participant RC flying challenge website. Each pilot creates an account with an email sign-in link and a nickname, uploads one field photo during each weekly period, and sees the shared leaderboard.

**The challenge is intentionally unstarted.** The database starts with **start_at = NULL**. No week is counted until the designated challenge owner presses **Start challenge** in the website.

## Challenge rules built into the app

- The challenge lasts exactly **360 days** from the moment it is activated.
- There are **52 check-in periods**: 51 full 7-day periods and a final 3-day period.
- Each participant can submit one photo for the currently open period.
- A period only becomes “missed” after that period ends without a photo.
- Weeks left = 52 − completed weeks − missed weeks.
- The leaderboard shows nicknames and totals only. Email addresses and proof-photo files are private.
- Proof photos accept JPG, PNG, or WebP up to 8 MB.

## Tech stack

- React + Vite for the website.
- Supabase Auth for passwordless email sign-in.
- Supabase Postgres with row-level security for profiles, challenge settings, submissions, and the leaderboard.
- Supabase private Storage bucket for field photos.
- Static hosting works with Cloudflare Pages.

## 1. Create and configure Supabase

1. Create a project at [Supabase](https://supabase.com/dashboard).
2. Open **SQL Editor** in that project.
3. Run the complete contents of **supabase/schema.sql**.
4. In **Authentication → URL Configuration**, set the Site URL to your deployed website address. Add the local development URL (for example, http://localhost:5173) and your deployed URL to the Redirect URLs list.
5. In **Authentication → Providers → Email**, keep email sign-in enabled. The website uses a magic link, so participants do not need a password or phone number.

### Make your account the challenge owner

After deploying the site, create your own account first. In Supabase, open **Authentication → Users**, copy the UUID for your account, then run this in the SQL Editor (replace the example UUID):

    update public.challenge_settings
    set owner_id = 'YOUR-AUTH-USER-UUID'
    where id = 1;

This grants your account the only website control that can start the challenge. It does **not** start the timer. The challenge remains unstarted until you deliberately press **Start challenge** on the dashboard.

Do not share your Supabase service-role key. The website only uses the public anon/publishable key.

## 2. Run locally

    npm install
    cp .env.example .env

Set the two values in **.env** using **Supabase → Project Settings → API**:

    VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
    VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY

Then start the development server:

    npm run dev

Vite will print the local address, usually http://localhost:5173.

## 3. Deploy to Cloudflare Pages

Connect the **daneharp32/RC-plane** GitHub repository to Cloudflare Pages and use:

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Build command | npm run build |
| Build output directory | dist |
| Root directory | / |

Add **VITE_SUPABASE_URL** and **VITE_SUPABASE_PUBLISHABLE_KEY** under **Settings → Environment variables** for the production environment. Add the deployed Pages URL to Supabase's Auth Redirect URLs. The **public/_redirects** file provides the SPA fallback.

## 4. Invite your friends

Share the website URL. Each friend chooses **Create account**, enters a nickname and email, and opens the magic link sent to their email. Once signed in, they appear on the leaderboard.

Nicknames are public to the participant group, so use a nickname rather than a full name. Email addresses are only used by Supabase for authentication. Photos are stored in a private bucket and are not exposed in the leaderboard.

## Important behavior

- The app does not invent a start date or start the challenge during deployment.
- Only the designated owner can activate the challenge, and the activation action is one-time.
- The database blocks photo submissions outside the currently open weekly period.
- A participant can submit only once for each week. The app will not let someone go back and fill in a missed week.
- The last check-in period is shorter because 360 days is 51 weeks plus 3 days.
