# Games

**A quiz or trivia game is a deck. Each student's answer is its own row, so one
student's save can never undo another's.**

Written 2026-09-14 with Andrew. The decisions below are his, answered one at a
time; the mockups are on the Game Panel canvas
(https://claude.ai/code/artifact/4f4b0eed-99b0-4d90-a9b6-62e519e2b4cc), drawn
from the spring COMM 118 games.

## Why

In spring, every student's answers lived inside one record for the whole class
(`comm118-game-v14` in `app_data`). Each phone saved that whole record, so two
phones saving at once meant the second wiped out the first. Answers vanished.
Choose-then-submit was not the cause. Where the answers were stored was.

Decks already stores one row per card per viewer. A game built on decks
cannot lose an answer that way, and encore and f5 get the same game later.

## What Andrew decided

**Taking the game**
- One deck per game for the whole class. He opens it; the deck sits at the top of
  the student page; a student taps it to start. Not a gate: the site stays usable.
- One question at a time, same order and same option order for everyone.
- Tap selects. **Submit** locks the answer and moves on. No going back.
- **Please review** in the bottom corner of each question. A student can uncheck
  it before Submit. His panel sees how many, never who.
- Only submitted answers count. A tapped answer with no Submit when time runs out
  is blank.
- Leaving mid-game picks up at the next unanswered question.
- After the last Submit: only that they are done, until he releases scores and/or
  answers. Released results show in the deck and on the grades page.
- Questions can hold an image. No video.

**Kinds of game**
- Individual or teams, chosen per game. Teams answer on one phone; the team types
  its name; teams are set in the panel or picked by the phone, chosen per game.
  Every member gets the team's score. A student on no team: he adds them to one.
- Multiple choice or free-form, set per question (a game may mix them).

**Time and closing**
- Optional timer for the whole game, only when he turns time on.
- Closes when he presses Close (which asks to confirm) or at a set time. No
  reopening.
- Time left shows minutes above a minute ("5 min"), seconds only in the last one.
- An absent student he picks can take the game later, with a time he sets. A
  closing time must never cut that attempt short.

**Scoring**
- Every question worth the same. No partial credit.
- Free-form: accepted answers typed ahead; close spellings group with an accepted
  answer for a one-tap confirm.
- He can accept a different answer at any time. Every score, the ranking and
  released scores update on their own.
- Ranking is percent right out of questions answered so far.
- A question under 50% right is marked tough.
- Gradebook: chosen per game.

**Game panel** (one per class, opened from More → Games)
- Before: questions, individual or teams, time, closing time, gradebook.
- During: answers as they arrive; each question's spread, percent right and
  Please review count; ranking; answering / submitted / not started.
- One question: each option, how many picked it, how many of those asked for
  review, Accept with a preview of what changes.
- Free-form: accepted, close to accepted, other answers, each with Accept.
- After: Release scores, Release answers, Take it later, room screen views.
- A game moves to another class's shelf, runs and all, once no run of it is open.
  Duplicate makes a fresh game beside it with the same questions and no runs.

**Room screen**
- During: time left and how many submitted. Calm, not a countdown in your face.
- After, anonymous: Spread of scores and All questions, both with labelled axes.
  Clicking a question in All questions opens it: options, picked, Please review.
- Team names can go up. Individual names never.
- Later version: animate what goes up.

## The build

Seven steps. Each one ends with its tests passing and something Andrew can look
at; nothing ships to production without his yes.

### 1. Schema: `migrations/003_games.sql`

Additive only. Nothing existing is dropped or rewritten.

- **`decks`** gains `kind` (`gate` | `game`), `teams` (`none` | `panel` |
  `phone`), `time_limit_min`, `closes_at`, `closed_at`, `scores_released_at`,
  `answers_released_at`, `gradebook`.
- **`deck_cards`** gains the type `question`. Config holds the text, an optional
  image, `choice` or `typed`, and the options. **Not the answer.**
- **`deck_keys`** (new): the right answer per card, and accepted answers for
  free-form. Readable by the instructor always, by students only once answers
  are released. Answers in `deck_cards.config` would reach every phone.
- **`deck_accepts`** (new): answers he accepted later, one row each. Scores are
  computed from keys plus accepts, never stored per response, which is how
  accepting an answer rescores everything with no rewrite.
- **`deck_responses`** gains `review` (boolean). Submit is an **insert**; there
  is no update policy for students, so a submitted answer cannot change and
  "no going back" holds on the server, not only on the phone.
- **`deck_teams`** (new): id, deck, name, members.
- **`deck_extra_time`** (new): deck, viewer, minutes, granted by.
- **RLS**, strict, since class students sign in:
  - A student inserts only rows where `viewer_id` is their own sign-in (or their
    team's id, if they are a member).
  - The insert is refused once the game is closed or the student's time is up.
  - The instructor reads everything, by email, the same check `api/_auth.js`
    uses, so the panel can subscribe to answers live.
  - Every write keeps `.select()`, because RLS fails silently.

### 2. Scoring, as plain functions: `src/games/score.js`

No React, no Supabase, fully tested.
- `scoreGame(cards, keys, accepts, responses)` gives, per viewer, right and
  answered, and, per question, the spread, percent right, the review count and
  review by option.
- `groupTyped(answers, accepted)` puts close spellings with an accepted answer.
  Normalise case, spacing and punctuation, then edit distance scaled to length.
- `timeLeft(seconds)` gives "5 min" or "45 sec".
- `spreadBuckets(scores)` gives the Spread of scores bars.

Tests use the spring Week 1 game (28 students, real answer counts), so the numbers
on the canvas are the numbers the tests expect: 46% on question 4, a class
average of 74%.

### 3. The phone: `src/games/QuizDeck.jsx`

- A question card for `choice` and `typed`, on the design system: Outfit, the
  warm greys, 44px targets, type from 20.
- Submit, Please review, progress, time left, the done screen.
- For team games, a start card: team name, and members when the phone picks them.
- Resume from `deck_progress`.
- Keyboard and reduced motion from day one.
- Decks' own `tokens.js` moves onto `~/.claude/DESIGN.md` here, which is overdue.
- Smoke test: two students submitting the same question at the same moment both
  land. That is the spring bug, and it gets a test of its own.

### 4. Student side in classes

- The open game sits at the top of the class page; tapping it opens `QuizDeck`
  full screen.
- Released scores and answers show in the finished deck and on the grades page.

### 5. Game panel in classes

Replaces what `/rungame` shows today; More → Games keeps the same link.
- Games list, add, and setup (step 1 of the panel).
- During, live over a Supabase realtime subscription on `deck_responses` for the
  one deck.
- One question with Accept and its preview; free-form groups; Close with confirm.
- After: Release scores, Release answers, Take it later, and the room screen
  buttons.

### 6. Room screen

New slide templates in `RoomSlide.jsx`, on the same paper or slate grounds:
during, Spread of scores, All questions, one question, teams. The wall reads the
same scoring functions as the panel, so the two can never disagree.

### 7. Spring and weekly games move over

A script reads `comm118-game-v14` and the class records and writes each game as a
deck with its questions and keys. It runs as a dry run first, printing what it
would write; the real run waits for his yes. The old game system stays in place
until the new one has run a class, and is removed only when he says.

## Before step 1

1. **How classes gets the decks code.** Vercel builds classes on its own and
   cannot see `~/Projects/decks`. Either push decks to GitHub and add it to
   classes as a git dependency, or copy the game files into classes and pull them
   back into decks when encore or f5 needs them. **A new dependency needs his OK.**
2. **Running the migrations.** The decks tables do not exist in the classes
   Supabase project yet (checked 2026-09-14: `decks` returns 404). Migrations 001,
   002 and 003 run once, in the Supabase SQL editor or by CLI.
3. **Old answers.** Step 7 moves the spring answers too, for history (decided
   2026-09-14).

**Status, 2026-09-14.** Migrations 001 to 004 ran on the classes Supabase project (9 tables, 21 policies, 2 hosts). `003_games.sql` and `004_signed_in_rls.sql`
are written and pass 21 checks in a local Postgres with Supabase's sign-in
stubbed (two students answering at once both land, no answering as someone
else, no changing a submitted answer, keys hidden until release, closing, time
limits, extra time, team phones). A student's viewer id is their lowercased
sign-in email.

**Steps 2 and 3 built, 2026-09-14.** `src/games/score.js`, `store.js`,
`QuizDeck.jsx` (with `TeamStart`) and `GameDeck.jsx`. 42 checks in
`scripts/smoke-games.jsx` run in `npm test` and in `npm run build`, scored
against real spring answers in `scripts/fixtures/spring.js` (students
anonymised). `tokens.js` is now the design system. `npm run dev` opens a local
preview at `/dev/` with Week 1 or `?game=week7`, running GameDeck against the
fake client. Words on the phone that Andrew has not written yet: "Not saved.
Submit again.", "Team name", "Start", "Not saved. Start again."

**The game panel, built 2026-09-14.** `src/games/GamePanel.jsx` and `host.js`
live in decks rather than classes, so encore and f5 get the same panel; classes
mounts `GamePanelLive` behind More → Games. All questions and the ranking update
live (realtime, or polling on the preview's fake client); clicking a question
shows picked and Please review per answer, with Accept and its preview; typed
answers are grouped right, close, other; Close confirms; after closing:
Release, Take it later, and Put on screen. A phone sitting on a question goes
to done when the game closes. Not built yet: adding and editing a game (the
panel's "before" screen) and the room screen slides. Preview:
`/dev/panel.html` (and `?game=week7`, `&speed=3`), with a pretend class of 28
answering Week 1 with its real spring answers and your phone beside it. Adding and editing games (GameSetup), the games list (GamesHome), and the student card with the agreement box (GameInvite) followed the same day. Words
Andrew has not written yet: "Let in", "min", "Released", "Mixed", "Cancel".

**How apps get decks (decided 2026-09-14).** The decks repo is public, and each
app installs it from GitHub pinned to a version tag:
`npm i git+https://github.com/awishak/decks.git#v0.1.0`. npm runs `prepare`
(vite build) on install, so `dist/` stays out of git. A change reaches an app
only when that app bumps its tag, so work driven from classes cannot break f5.
Private options were ruled out: a token in a git URL would sit in the public
classes and f5 repos, and GitHub Packages is a new service with a token that
expires.

## Things that will bite

- **RLS swallows writes with no error.** A lost answer looks like a student who
  never answered. `.select()` on every write, and a check in step 5 that counts
  rows against Submits.
- **Answers leaking.** Anything in `deck_cards` reaches every phone. Keys live in
  their own table for this reason.
- **Clock trust.** The phone's clock decides nothing; the insert policy compares
  against the database's `now()`.
- **Team phones.** A team row's `viewer_id` is the team, not a person. Scoring and
  the gradebook fan it out to members, and the ranking shows the team.
- **Editing a live game.** Blocked once the first answer lands, apart from
  accepting answers. Changing a question under 25 phones is the kind of mess
  this rebuild exists to avoid.
