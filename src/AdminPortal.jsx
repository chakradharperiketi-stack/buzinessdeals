-- 004_admin_portal.sql
-- Backs the new Admin Portal (Listings moderation + Leads queue).
--
-- Purely additive and idempotent: every ALTER TABLE uses IF NOT EXISTS, and
-- every CREATE POLICY is preceded by a matching DROP POLICY IF EXISTS. Safe
-- to run more than once. Nothing here removes or narrows any access that
-- already works today - the anon lead-capture insert on the landing page
-- and the seller listing-submission insert are both left untouched.

-- ---------------------------------------------------------------------------
-- 1. Tracking columns the Admin Portal needs, added defensively in case they
--    don't already exist. If a column already exists, its ADD COLUMN IF NOT
--    EXISTS line is a no-op.
-- ---------------------------------------------------------------------------

alter table public.listings add column if not exists created_at timestamptz not null default now();
alter table public.listings add column if not exists reviewed_at timestamptz;
alter table public.listings add column if not exists reviewed_by text;
alter table public.listings add column if not exists rejection_reason text;

alter table public.leads add column if not exists created_at timestamptz not null default now();
alter table public.leads add column if not exists contacted boolean not null default false;
alter table public.leads add column if not exists contacted_at timestamptz;
alter table public.leads add column if not exists admin_notes text;

-- ---------------------------------------------------------------------------
-- 2. Leads: admin read/write access.
--
--    listings already has a working "Admin full access" policy (fixed in
--    the previous migration round) that covers SELECT + UPDATE for the
--    admin email allowlist - nothing further needed there.
--
--    leads currently has no admin-facing policy at all (only ever written
--    to, anonymously, by the landing page lead form). Enabling RLS is a
--    no-op if it's already on. The explicit "with check (true)" insert
--    policy below exists ONLY to guarantee the existing anonymous
--    lead-capture flow keeps working unchanged even in the (unlikely,
--    unverified) case that RLS was previously off and access relied on
--    RLS being disabled - it grants nothing beyond what already works
--    today. If a differently-named insert policy already exists, this one
--    simply sits alongside it (Postgres ORs permissive policies together).
-- ---------------------------------------------------------------------------

alter table public.leads enable row level security;

drop policy if exists "Anyone can submit a lead" on public.leads;
create policy "Anyone can submit a lead"
on public.leads for insert
to anon, authenticated
with check (true);

drop policy if exists "Admin full access to leads" on public.leads;
create policy "Admin full access to leads"
on public.leads for all
to authenticated
using (
  (auth.jwt() ->> 'email') = any (array[
    'zeniusadvisors@gmail.com',
    'chakradhar@vkcorpca.com',
    'chakri@buzinessdeals.com'
  ])
)
with check (
  (auth.jwt() ->> 'email') = any (array[
    'zeniusadvisors@gmail.com',
    'chakradhar@vkcorpca.com',
    'chakri@buzinessdeals.com'
  ])
);