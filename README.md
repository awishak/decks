# @ishak/decks

Full-screen cards that block a site until the viewer has read them and answered
what you asked.

A stack of cards appears when someone opens the site. They tap through one at a
time and cannot get in until they are done. Some cards just tell them something.
Others ask for something: pick an option, type an answer, paste a link, tick a
box. Answers save as they go, so closing the tab loses nothing.

Built for two live consumers: class sites that need students to read the
guidelines and hand something back, and Formula 5, which needs a personalised
ten-card season recap. Same machinery, different cards.

See [BRIEF.md](./BRIEF.md) for the full design and the decisions behind it.

## Status

**Early. The schema and the pure logic are done and tested. The storage layer is
not written yet.**

| | |
|---|---|
| Supabase schema and RLS | done, `migrations/` |
| Branching, resume, required-card logic | done and tested, `src/resolve.js` |
| Deck shell and seven card types | done |
| Both real decks encoded as data | done, `seeds/` |
| `DeckGate` and the storage layer | done and tested |
| Keyboard navigation | **not started, and it blocks shipping** |
| Admin dashboard section | **not started** |
| Real class guidelines copy | **placeholders only** |

## Install

```
npm install
npm run smoke      # logic assertions, every card rendered, type floor
npm run build      # library bundle to dist/
```

Then run the files in `migrations/` against your Supabase project, in order. **Read the RLS
block at the bottom of it first** — the default is permissive and suits an
anon-key app with no auth. A site with real logins needs the strict variant.

## Use

Wrap your app once. That is the whole integration.

```jsx
import { DeckGate } from "@ishak/decks";

<DeckGate
  supabase={supabase}
  viewer={{ id: student.id, name: student.first_name }}
  groups={[`class:${course}:${term}`]}
>
  <App />
</DeckGate>
```

`DeckGate` asks Supabase whether this viewer owes any decks. If they do, it
renders the first one **instead of** your app, saves every answer as it happens,
marks the deck finished, moves to the next pending one, and then renders your
app and gets out of the way. Two pending decks run back to back.

With no viewer it renders your app immediately, so it is safe to mount above a
login.

`Deck` is also exported on its own for cases with no storage, and knows nothing
about Supabase. It takes answers in and reports them out, which is why it
renders identically in a test and in a browser.

### Failing open

If Supabase is unreachable, `DeckGate` lets people into the app by default. A
blip should not lock a whole class out of the site. Pass `failOpen={false}` if
the gate matters more than availability.

## How it is put together

**Identity is the host app's problem.** `viewer_id` is `text`, not a foreign key
to `auth.users`. Class sites pass a Supabase Auth uuid. Formula 5 passes the
name the player picked off a list, because that app has no auth at all. This one
decision is what lets both use the same tables.

**Group membership is also the host app's problem.** The host says which groups
a viewer is in. Decks says what they still owe. It never needs to know what a
roster is.

**One saved row per viewer per card.** Makes "who picked B on card 3" a plain
query and makes resume nearly free.

**Every card is required.** Advancing past a card that asks something needs a
valid answer.

**Branch targets are card keys, never positions.** Positions move when you
reorder; keys do not. A branch pointing at a retired or misspelled card falls
through to the next live card rather than stranding the viewer.

**Cards are soft-deleted.** Retiring stops a card being served, keeps its stored
answers, and never reuses its id.

**Resume replays stored answers through the branch rules** rather than trusting a
saved index, so a deck edited since someone started still lands them somewhere
real.

## Card types

`read` · `acknowledge` · `pick_one` · `pick_many` · `free_text` · `link` ·
`external` · `custom`

`custom` renders a component the host registered by name and hands it the
viewer's data. This is how the F5 ladder flythrough and team board survive in a
system that otherwise stores cards as data.

Any card can declare `beats`, which reveal in stages behind the same button.

## Editing a live deck

There is no version table, on purpose. Instead:

- Text and label edits go live immediately. That is almost every edit.
- Changing a card's type, or its options in a way that invalidates stored
  answers, is **a new card**, not an edit. Retire the old one.
- Reordering is safe, because progress records a card id and not an index.

## Two things that will bite

**RLS will swallow writes silently.** A policy mismatch fails with no error and
this system writes on every card, so a lost answer looks exactly like a student
who never answered. Every write must append `.select()` and surface failures.

**A blocking interstitial with no keyboard path is a trap.** There is no escape
hatch by design, which makes keyboard navigation and focus management a
correctness requirement rather than polish. Not done yet.

## Layout

```
migrations/   the schema. the actual product.
src/
  resolve.js  branching, resume, validation. no React, no network.
  Deck.jsx    the shell. centring and headline-first live here.
  cards/      the seven built-in card bodies.
  tokens.js   design tokens and the executable 13px floor.
seeds/        both real decks, as data.
scripts/      the headless test harness.
```
