-- Games: a quiz or trivia game is a deck.
--
-- Spring 2026's COMM 118 game kept every student's answers inside one record
-- for the whole class, and each phone saved that whole record, so two phones
-- saving at once meant the second wiped out the first. Here every answer is its
-- own row in deck_responses, written once, by the student who gave it.
--
-- Additive only: new columns, new tables, new functions. Nothing is dropped
-- except the card type check, which is recreated with 'question' in it.
--
-- Decisions behind the shape are in GAMES.md.

-- ───────────────────────────────────────────────────────────── decks

alter table decks add column if not exists kind text not null default 'gate';
alter table decks add column if not exists teams text not null default 'none';
alter table decks add column if not exists time_limit_min int;
alter table decks add column if not exists opened_at timestamptz;
alter table decks add column if not exists closes_at timestamptz;
alter table decks add column if not exists closed_at timestamptz;
alter table decks add column if not exists scores_released_at timestamptz;
alter table decks add column if not exists answers_released_at timestamptz;
alter table decks add column if not exists gradebook boolean not null default false;

alter table decks drop constraint if exists decks_kind_check;
alter table decks add constraint decks_kind_check check (kind in ('gate', 'game'));
alter table decks drop constraint if exists decks_teams_check;
alter table decks add constraint decks_teams_check check (teams in ('none', 'panel', 'phone'));
alter table decks drop constraint if exists decks_time_limit_check;
alter table decks add constraint decks_time_limit_check check (time_limit_min is null or time_limit_min > 0);

comment on column decks.kind is
  'gate: blocks the site until done. game: sits on the page, opened by the host, answered once per question.';
comment on column decks.teams is
  'none: each viewer answers. panel: the host sets teams. phone: a team phone names itself and picks members.';

-- ──────────────────────────────────────────────────────────── cards

-- A question card's config: { text, image?, answer: 'choice' | 'typed', options? }.
-- Never the right answer, because every card reaches every phone.
alter table deck_cards drop constraint if exists deck_cards_type_check;
alter table deck_cards add constraint deck_cards_type_check check (type in (
  'read', 'acknowledge', 'pick_one', 'pick_many',
  'free_text', 'link', 'external', 'custom', 'question'));

-- ───────────────────────────────────────────────────────────── keys

-- The right answer, apart from the card. choice: [index, ...]. typed: ["foosball", ...].
create table if not exists deck_keys (
  card_id  uuid primary key references deck_cards(id) on delete cascade,
  deck_id  uuid not null references decks(id) on delete cascade,
  correct  jsonb not null default '[]'::jsonb
);

-- An answer the host accepted after the fact. Scores are computed from keys
-- plus accepts, never stored per response, so accepting one rescores everyone.
create table if not exists deck_accepts (
  id           uuid primary key default gen_random_uuid(),
  deck_id      uuid not null references decks(id) on delete cascade,
  card_id      uuid not null references deck_cards(id) on delete cascade,
  value        jsonb not null,
  accepted_at  timestamptz not null default now(),
  unique (card_id, value)
);

-- ──────────────────────────────────────────────────────── responses

alter table deck_responses add column if not exists review boolean not null default false;
comment on column deck_responses.review is 'Please review, ticked before Submit.';

-- ──────────────────────────────────────────────────────────── teams

-- A team's id is its viewer_id in deck_responses: one phone answers for all of them.
create table if not exists deck_teams (
  id          text primary key default ('team:' || gen_random_uuid()::text),
  deck_id     uuid not null references decks(id) on delete cascade,
  name        text not null,
  members     text[] not null default '{}',
  created_at  timestamptz not null default now(),
  unique (deck_id, name)
);

-- ─────────────────────────────────────────────────────── extra time

-- A student the host lets take a game later, with the minutes the host gives.
create table if not exists deck_extra_time (
  deck_id     uuid not null references decks(id) on delete cascade,
  viewer_id   text not null,
  minutes     int not null check (minutes > 0),
  granted_at  timestamptz not null default now(),
  primary key (deck_id, viewer_id)
);

-- ──────────────────────────────────────────────────────────── hosts

-- Who runs games in this project, by sign-in email. Each host app seeds it.
create table if not exists deck_hosts (
  email  text primary key
);

-- ──────────────────────────────────────────────────────── functions

-- The signed-in viewer, as a lowercased email. Class rosters are keyed by
-- email, so a response row names a student the roster can find.
create or replace function deck_viewer() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function deck_is_host() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from deck_hosts h where h.email = deck_viewer())
$$;

-- Whether the signed-in viewer may answer as viewer v: themselves, or a team
-- they are on.
create or replace function deck_speaks_for(d uuid, v text) returns boolean
language sql stable security definer set search_path = public as $$
  select v = deck_viewer()
    or exists (select 1 from deck_teams t where t.id = v and t.deck_id = d and deck_viewer() = any (t.members))
$$;

-- Whether viewer v can still answer game d, by the database's clock, never a phone's.
--   In class: opened, not closed, before the closing time, inside the time limit.
--   Taking it later: the host's minutes, counted from when they started or were
--   let in, whichever is later, whatever the closing time says.
create or replace function deck_can_answer(d uuid, v text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from decks k
    left join deck_progress p on p.deck_id = k.id and p.viewer_id = v
    left join deck_extra_time x on x.deck_id = k.id and x.viewer_id = v
    where k.id = d and k.published and (
      k.kind = 'gate'
      or (k.opened_at is not null and k.closed_at is null
          and (k.closes_at is null or now() < k.closes_at)
          and (k.time_limit_min is null or p.started_at is null
               or now() < p.started_at + make_interval(mins => k.time_limit_min)))
      or (x.viewer_id is not null
          and (p.started_at is null
               or now() < greatest(p.started_at, x.granted_at) + make_interval(mins => x.minutes)))
    )
  )
$$;

-- One way of comparing answers, used by scoring here and mirrored in the
-- package's score.js: case, outer spaces, punctuation and repeated spaces do not
-- count. A choice index compares as its number.
create or replace function deck_norm(v jsonb) returns text
language sql immutable as $$
  select case jsonb_typeof(v)
    when 'string' then regexp_replace(regexp_replace(lower(btrim(v #>> '{}')), '[[:punct:]]+', '', 'g'), '\s+', ' ', 'g')
    else v::text
  end
$$;

-- Right and answered per viewer. The host sees everyone, any time. A viewer
-- sees their own row (or their team's), once scores are released.
create or replace function deck_scores(d uuid)
returns table (viewer_id text, right_count int, answered int)
language sql stable security definer set search_path = public as $$
  select r.viewer_id,
         count(*) filter (where
           exists (select 1 from deck_keys k, jsonb_array_elements(k.correct) c
                   where k.card_id = r.card_id and deck_norm(c) = deck_norm(r.answer -> 'value'))
           or exists (select 1 from deck_accepts a
                      where a.card_id = r.card_id and deck_norm(a.value) = deck_norm(r.answer -> 'value'))
         )::int,
         count(*)::int
  from deck_responses r
  join deck_cards c on c.id = r.card_id and c.type = 'question'
  join decks k on k.id = r.deck_id
  where r.deck_id = d
    and (deck_is_host() or (k.scores_released_at is not null and deck_speaks_for(d, r.viewer_id)))
  group by r.viewer_id
$$;

-- A started clock does not move: a student cannot buy time by rewriting it.
create or replace function deck_progress_keep_start() returns trigger
language plpgsql as $$
begin
  new.started_at := old.started_at;
  return new;
end
$$;

drop trigger if exists deck_progress_keep_start on deck_progress;
create trigger deck_progress_keep_start before update on deck_progress
  for each row execute function deck_progress_keep_start();

-- ──────────────────────────────────────────────────────── realtime

-- The game panel watches answers and progress arrive. Realtime applies RLS,
-- so a student's subscription only ever sees their own rows.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'deck_responses') then
      alter publication supabase_realtime add table deck_responses;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'deck_progress') then
      alter publication supabase_realtime add table deck_progress;
    end if;
  end if;
end
$$;
