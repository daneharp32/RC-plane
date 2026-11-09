-- FieldLog: private weekly RC flight photo challenge.
-- Run this entire file in the Supabase SQL Editor.

create extension if not exists pgcrypto;

-- One row controls the global challenge. start_at intentionally starts as NULL.
create table if not exists public.challenge_settings (
  id smallint primary key default 1 check (id = 1),
  start_at timestamptz null,
  duration_days integer not null default 360 check (duration_days = 360),
  owner_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into public.challenge_settings (id, start_at, duration_days)
values (1, null, 360)
on conflict (id) do nothing;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(btrim(nickname)) between 2 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_nickname_lower_unique
  on public.profiles (lower(nickname));

create table if not exists public.weekly_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_number integer not null check (week_number between 1 and 52),
  photo_path text not null,
  submitted_at timestamptz not null default now(),
  unique (user_id, week_number)
);

-- Create a profile automatically when a verified account is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen_nickname text;
begin
  chosen_nickname := nullif(btrim(new.raw_user_meta_data ->> 'nickname'), '');
  if chosen_nickname is null then
    chosen_nickname := 'Pilot-' || upper(substr(new.id::text, 1, 5));
  end if;

  insert into public.profiles (user_id, nickname)
  values (new.id, chosen_nickname);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_fieldlog on auth.users;
create trigger on_auth_user_created_fieldlog
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.touch_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_profile_updated_at on public.profiles;
create trigger touch_profile_updated_at
  before update on public.profiles
  for each row execute procedure public.touch_profile_updated_at();

-- Reports whether the signed-in account is the designated challenge owner.
create or replace function public.is_challenge_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.challenge_settings
    where id = 1 and owner_id = auth.uid()
  );
$$;

-- Only the designated owner can activate the challenge. This is intentionally
-- separate from deployment: the challenge remains unstarted until this is called.
create or replace function public.start_challenge()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  activated_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to start the challenge.';
  end if;

  if not exists (
    select 1 from public.challenge_settings
    where id = 1 and owner_id = auth.uid()
  ) then
    raise exception 'Only the designated challenge owner can start the challenge.';
  end if;

  update public.challenge_settings
  set start_at = clock_timestamp()
  where id = 1 and start_at is null
  returning start_at into activated_at;

  if activated_at is null then
    raise exception 'The challenge has already been started.';
  end if;

  return activated_at;
end;
$$;

-- A submission is allowed only for the currently open 7-day period.
-- The 52nd period is the final 3 days of the 360-day challenge.
create or replace function public.can_submit_week(requested_week integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.challenge_settings c
    where c.id = 1
      and c.start_at is not null
      and now() >= c.start_at
      and now() < c.start_at + interval '360 days'
      and requested_week between 1 and 52
      and requested_week = floor(extract(epoch from (now() - c.start_at)) / 604800)::integer + 1
  );
$$;

-- Number of full 7-day periods that have ended. At day 360, all 52 slots
-- are considered elapsed (51 full weeks plus the final 3-day slot).
create or replace function public.get_challenge_overview()
returns table (
  start_at timestamptz,
  duration_days integer,
  total_weeks integer,
  elapsed_weeks integer,
  current_week integer,
  is_started boolean,
  is_finished boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.start_at,
    c.duration_days,
    52,
    case
      when c.start_at is null or now() < c.start_at then 0
      when now() >= c.start_at + interval '360 days' then 52
      else floor(extract(epoch from (now() - c.start_at)) / 604800)::integer
    end,
    case
      when c.start_at is null or now() < c.start_at or now() >= c.start_at + interval '360 days' then null
      else floor(extract(epoch from (now() - c.start_at)) / 604800)::integer + 1
    end,
    c.start_at is not null,
    c.start_at is not null and now() >= c.start_at + interval '360 days'
  from public.challenge_settings c
  where c.id = 1;
$$;

-- Nicknames and totals only. Email addresses and photo paths are never returned.
create or replace function public.get_leaderboard()
returns table (
  user_id uuid,
  nickname text,
  weeks_completed integer,
  weeks_missed integer,
  weeks_left integer
)
language sql
stable
security definer
set search_path = public
as $$
  with clock as (
    select
      case
        when c.start_at is null or now() < c.start_at then 0
        when now() >= c.start_at + interval '360 days' then 52
        else floor(extract(epoch from (now() - c.start_at)) / 604800)::integer
      end as elapsed_slots
    from public.challenge_settings c
    where c.id = 1
  ),
  per_pilot as (
    select
      p.user_id,
      p.nickname,
      count(s.id)::integer as completed,
      (count(s.id) filter (where s.week_number <= clock.elapsed_slots))::integer as completed_elapsed
    from public.profiles p
    cross join clock
    left join public.weekly_submissions s on s.user_id = p.user_id
    group by p.user_id, p.nickname, clock.elapsed_slots
  )
  select
    per_pilot.user_id,
    per_pilot.nickname,
    per_pilot.completed,
    greatest(clock.elapsed_slots - per_pilot.completed_elapsed, 0)::integer,
    greatest(52 - per_pilot.completed - greatest(clock.elapsed_slots - per_pilot.completed_elapsed, 0), 0)::integer
  from per_pilot
  cross join clock
  order by per_pilot.completed desc,
           greatest(clock.elapsed_slots - per_pilot.completed_elapsed, 0) asc,
           per_pilot.nickname asc;
$$;

alter table public.challenge_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.weekly_submissions enable row level security;

drop policy if exists "Signed-in participants can read challenge settings" on public.challenge_settings;
create policy "Signed-in participants can read challenge settings"
  on public.challenge_settings for select
  to authenticated
  using (true);

drop policy if exists "Participants can see profile nicknames" on public.profiles;
create policy "Participants can see profile nicknames"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "Participants can edit their own nickname" on public.profiles;
create policy "Participants can edit their own nickname"
  on public.profiles for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Participants can read their own submissions" on public.weekly_submissions;
create policy "Participants can read their own submissions"
  on public.weekly_submissions for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Participants can submit their own current week" on public.weekly_submissions;
create policy "Participants can submit their own current week"
  on public.weekly_submissions for insert
  to authenticated
  with check (user_id = auth.uid() and public.can_submit_week(week_number));

-- Private proof-photo bucket. Other participants cannot view your uploaded images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flight-proofs', 'flight-proofs', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = 8388608,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Participants upload their own proof photos" on storage.objects;
create policy "Participants upload their own proof photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'flight-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Participants view their own proof photos" on storage.objects;
create policy "Participants view their own proof photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'flight-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Participants delete their own proof photos" on storage.objects;
create policy "Participants delete their own proof photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'flight-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Keep database RPC endpoints private to signed-in participants.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.touch_profile_updated_at() from public, anon, authenticated;
revoke all on function public.is_challenge_owner() from public, anon;
revoke all on function public.start_challenge() from public, anon;
revoke all on function public.can_submit_week(integer) from public, anon;
revoke all on function public.get_challenge_overview() from public, anon;
revoke all on function public.get_leaderboard() from public, anon;

grant select on public.challenge_settings to authenticated;
grant select on public.profiles to authenticated;
grant update (nickname) on public.profiles to authenticated;
grant select, insert on public.weekly_submissions to authenticated;
grant execute on function public.is_challenge_owner() to authenticated;
grant execute on function public.start_challenge() to authenticated;
grant execute on function public.can_submit_week(integer) to authenticated;
grant execute on function public.get_challenge_overview() to authenticated;
grant execute on function public.get_leaderboard() to authenticated;

-- IMPORTANT OWNER SETUP:
-- 1. Create your account on the website after deployment.
-- 2. In Supabase > Authentication > Users, copy your account's UUID.
-- 3. Run this once in the SQL Editor, replacing the UUID:
--    update public.challenge_settings
--    set owner_id = 'YOUR-AUTH-USER-UUID'
--    where id = 1;
-- Do not set start_at here. Use the website's Start challenge button when ready.
