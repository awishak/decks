-- Decks: the schema every consuming project shares.
--
-- Run once per Supabase project. Host apps own these tables and may alter them;
-- shipping the migration only means nobody has to invent the shape three times.
--
-- The design decision everything else hangs off: viewer_id is TEXT, not uuid and
-- not a foreign key to auth.users. Class sites pass a Supabase Auth uuid.
-- Formula 5 passes the name the player picked off a list, because that app has
-- no auth at all. Text holds both, and Decks never has to know which it got.

create extension if not exists "pgcrypto";

-- ────────────────────────────────────────────────────────────── decks

create table if not exists decks (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,        -- stable handle, e.g. 'class-guidelines-fa26'
  title       text not null,
  -- The host app decides what a group means and tells Decks which ones a viewer
  -- belongs to. Decks never needs to know what a roster is.
  group_key   text not null,
  published   boolean not null default false,
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_at  timestamptz not null default now()
);

comment on column decks.group_key is
  'Opaque to Decks. The host passes a list of groups for the viewer and we match on it.';

-- ─────────────────────────────────────────────────────────── deck_cards

create table if not exists deck_cards (
  id          uuid primary key default gen_random_uuid(),
  deck_id     uuid not null references decks(id) on delete cascade,
  position    int  not null,
  type        text not null check (type in (
                'read', 'acknowledge', 'pick_one', 'pick_many',
                'free_text', 'link', 'external', 'custom')),
  -- Everything the card needs to render: headline, body, options, the registry
  -- name for a custom card. Shape varies by type on purpose.
  config      jsonb not null default '{}'::jsonb,
  -- [{ "when": <answer value>, "goto": "<card key>" }]. First match wins,
  -- no match falls through to the next live card by position. The key column
  -- itself arrives in 002_card_key.sql.
  branches    jsonb,
  -- Soft delete. A retired card stops being served, its stored answers survive,
  -- and branches pointing at it fall through. Never hard-delete a card that has
  -- responses, and never reuse an id.
  retired_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists deck_cards_deck_pos
  on deck_cards (deck_id, position) where retired_at is null;

-- ─────────────────────────────────────────────────────── deck_responses

-- One row per viewer per card. Makes "who picked B on card 3" a plain query and
-- makes resume nearly free.
create table if not exists deck_responses (
  id           uuid primary key default gen_random_uuid(),
  deck_id      uuid not null references decks(id) on delete cascade,
  card_id      uuid not null references deck_cards(id),
  viewer_id    text not null,
  answer       jsonb,
  answered_at  timestamptz not null default now(),
  unique (card_id, viewer_id)
);

create index if not exists deck_responses_lookup
  on deck_responses (deck_id, viewer_id);

-- ──────────────────────────────────────────────────────── deck_progress

-- Resume point and completion. current_card_id is a CARD ID, never an index:
-- branching means position is not a count, and reordering must not move anyone.
create table if not exists deck_progress (
  deck_id          uuid not null references decks(id) on delete cascade,
  viewer_id        text not null,
  current_card_id  uuid references deck_cards(id),
  started_at       timestamptz not null default now(),
  completed_at     timestamptz,
  primary key (deck_id, viewer_id)
);

create index if not exists deck_progress_incomplete
  on deck_progress (deck_id) where completed_at is null;

-- ───────────────────────────────────────────────────────────────── RLS
--
-- READ THIS BEFORE ENABLING. One policy set does not fit both consumers, and
-- getting it wrong fails SILENTLY: a policy mismatch swallows the write with no
-- error, and a lost answer looks exactly like a student who never answered.
-- Every write in the client appends .select() so failures surface.
--
-- Default below is PERMISSIVE, which suits an anon-key app with no auth
-- (Formula 5). For a class site with real logins, comment it out and use the
-- strict block underneath, which pins every write to the authenticated user.

alter table decks           enable row level security;
alter table deck_cards      enable row level security;
alter table deck_responses  enable row level security;
alter table deck_progress   enable row level security;

-- Decks and cards are not secret. Anyone who can reach the app can read them.
create policy decks_read on decks
  for select using (true);
create policy deck_cards_read on deck_cards
  for select using (true);

-- PERMISSIVE (no auth). Anyone may write any viewer_id. This is already the
-- trust model of an anon-key app; it is NOT acceptable where logins exist.
create policy deck_responses_open on deck_responses
  for all using (true) with check (true);
create policy deck_progress_open on deck_progress
  for all using (true) with check (true);

-- STRICT (Supabase Auth). Swap the two policies above for these.
--
-- create policy deck_responses_own on deck_responses
--   for all using (auth.uid()::text = viewer_id)
--   with check (auth.uid()::text = viewer_id);
-- create policy deck_progress_own on deck_progress
--   for all using (auth.uid()::text = viewer_id)
--   with check (auth.uid()::text = viewer_id);
--
-- Admin reads go through the service role, which bypasses RLS. Never ship the
-- service-role key to the browser.
