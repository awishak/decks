-- Runs: a game is built once and run many times, once per class or section.
--
-- Until now a game and its one hosting were the same row, so a game that had
-- run could never run again: its answers, its closing and its released scores
-- were the game's own. Andrew teaches two sections of COMM 3 on the same day
-- and reruns games term to term. Now a game is the questions, and pressing Run
-- makes a run: a copy of the game's questions and right answers, opened to one
-- class or one section, holding that sitting's answers, approvals, closing and
-- releases. Rerunning never touches an earlier run.
--
-- Additive only.

alter table decks add column if not exists source_id uuid references decks(id) on delete set null;
alter table decks add column if not exists section text;

comment on column decks.source_id is
  'For a run: the game it was run from. Null for a game (and for a game run before runs existed, which is its own run).';
comment on column decks.section is
  'For a run: the section it was opened to, when the class has more than one. Null means the whole class.';

create index if not exists decks_source on decks (source_id) where source_id is not null;
