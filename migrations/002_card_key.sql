-- Cards get a key.
--
-- Everything in the package works in card KEYS: branching targets a key,
-- resume replays answers keyed by key, the shell finds the current card by
-- key. The first migration never gave deck_cards a key column, so the first
-- real load from Supabase would have handed the shell cards with no key and
-- broken resume and branching on the spot. The smoke test never saw this
-- because the fake client seeds cards with keys.
--
-- A key is stable and hand-authored, like 'welcome' or 'section', and unique
-- within its deck. Branches store keys, never ids and never positions.

alter table deck_cards add column if not exists key text;

-- Any card already in the table gets a key from its position, so nothing is
-- left null; rename those by hand to something that reads.
update deck_cards set key = 'card-' || position where key is null;

alter table deck_cards alter column key set not null;

create unique index if not exists deck_cards_deck_key on deck_cards (deck_id, key);

comment on column deck_cards.key is
  'Stable handle within the deck, e.g. ''welcome''. Branches point at keys, never at ids or positions.';
comment on column deck_cards.branches is
  '[{ "when": <answer value>, "goto": "<card key>" }]. First match wins; no match, or a retired target, falls through to the next live card.';
