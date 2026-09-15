-- Row level security for a project where viewers sign in with Supabase Auth.
--
-- 001 ships a PERMISSIVE policy set, right for an app with no sign-in at all
-- (Formula 5). A class site has sign-in, and there anyone could otherwise write
-- any student's answer. This file swaps 001's open policies for ones pinned to
-- the signed-in email (deck_viewer()), with hosts from deck_hosts.
--
-- Run it after 003, and only in a project whose viewers sign in.
--
-- The rules, in words:
--   Anyone signed in reads published decks and their cards. Hosts read and
--   write everything.
--   Right answers are read by hosts, and by viewers only once answers are
--   released.
--   A viewer writes answers only as themselves or their team, only while the
--   game will take an answer, and a game answer is written once: there is no
--   update, so Submit cannot be taken back.

alter table deck_keys        enable row level security;
alter table deck_accepts     enable row level security;
alter table deck_teams       enable row level security;
alter table deck_extra_time  enable row level security;
alter table deck_hosts       enable row level security;   -- no policies: read only through deck_is_host()

drop policy if exists decks_read on decks;
drop policy if exists deck_cards_read on deck_cards;
drop policy if exists deck_responses_open on deck_responses;
drop policy if exists deck_progress_open on deck_progress;

-- ───────────────────────────────────────────────────── decks, cards

drop policy if exists decks_see on decks;
create policy decks_see on decks for select
  using (published or deck_is_host());
drop policy if exists decks_host on decks;
create policy decks_host on decks for all
  using (deck_is_host()) with check (deck_is_host());

drop policy if exists deck_cards_see on deck_cards;
create policy deck_cards_see on deck_cards for select
  using (deck_is_host() or exists (select 1 from decks k where k.id = deck_id and k.published));
drop policy if exists deck_cards_host on deck_cards;
create policy deck_cards_host on deck_cards for all
  using (deck_is_host()) with check (deck_is_host());

-- ──────────────────────────────────────────────────── keys, accepts

drop policy if exists deck_keys_see on deck_keys;
create policy deck_keys_see on deck_keys for select
  using (deck_is_host() or exists (select 1 from decks k where k.id = deck_id and k.answers_released_at is not null));
drop policy if exists deck_keys_host on deck_keys;
create policy deck_keys_host on deck_keys for all
  using (deck_is_host()) with check (deck_is_host());

drop policy if exists deck_accepts_see on deck_accepts;
create policy deck_accepts_see on deck_accepts for select
  using (deck_is_host() or exists (select 1 from decks k where k.id = deck_id and k.answers_released_at is not null));
drop policy if exists deck_accepts_host on deck_accepts;
create policy deck_accepts_host on deck_accepts for all
  using (deck_is_host()) with check (deck_is_host());

-- ──────────────────────────────────────────────────────── responses

drop policy if exists deck_responses_see on deck_responses;
create policy deck_responses_see on deck_responses for select
  using (deck_is_host() or deck_speaks_for(deck_id, viewer_id));

drop policy if exists deck_responses_write on deck_responses;
create policy deck_responses_write on deck_responses for insert
  with check (deck_is_host() or (deck_speaks_for(deck_id, viewer_id) and deck_can_answer(deck_id, viewer_id)));

-- A gate's answer is saved by upsert, so a gate may update its own row. A
-- game's may not: its answer is final at Submit.
drop policy if exists deck_responses_gate_update on deck_responses;
create policy deck_responses_gate_update on deck_responses for update
  using (deck_speaks_for(deck_id, viewer_id)
         and exists (select 1 from decks k where k.id = deck_id and k.kind = 'gate'))
  with check (deck_speaks_for(deck_id, viewer_id));

drop policy if exists deck_responses_host on deck_responses;
create policy deck_responses_host on deck_responses for all
  using (deck_is_host()) with check (deck_is_host());

-- ───────────────────────────────────────────────────────── progress

drop policy if exists deck_progress_see on deck_progress;
create policy deck_progress_see on deck_progress for select
  using (deck_is_host() or deck_speaks_for(deck_id, viewer_id));

drop policy if exists deck_progress_start on deck_progress;
create policy deck_progress_start on deck_progress for insert
  with check (deck_speaks_for(deck_id, viewer_id) and deck_can_answer(deck_id, viewer_id));

-- Moving on and finishing. started_at is held still by its trigger in 003.
drop policy if exists deck_progress_move on deck_progress;
create policy deck_progress_move on deck_progress for update
  using (deck_speaks_for(deck_id, viewer_id)) with check (deck_speaks_for(deck_id, viewer_id));

drop policy if exists deck_progress_host on deck_progress;
create policy deck_progress_host on deck_progress for all
  using (deck_is_host()) with check (deck_is_host());

-- ──────────────────────────────────────────────────── teams, time

drop policy if exists deck_teams_see on deck_teams;
create policy deck_teams_see on deck_teams for select
  using (deck_is_host() or exists (select 1 from decks k where k.id = deck_id and k.published));

-- A team phone names its own team, and must be on it.
drop policy if exists deck_teams_phone on deck_teams;
create policy deck_teams_phone on deck_teams for insert
  with check (deck_viewer() = any (members)
              and exists (select 1 from decks k where k.id = deck_id and k.teams = 'phone' and k.published));

drop policy if exists deck_teams_host on deck_teams;
create policy deck_teams_host on deck_teams for all
  using (deck_is_host()) with check (deck_is_host());

drop policy if exists deck_extra_time_see on deck_extra_time;
create policy deck_extra_time_see on deck_extra_time for select
  using (deck_is_host() or viewer_id = deck_viewer());
drop policy if exists deck_extra_time_host on deck_extra_time;
create policy deck_extra_time_host on deck_extra_time for all
  using (deck_is_host()) with check (deck_is_host());
