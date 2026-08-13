# Stories

**Full-screen cards that block a site until the viewer has read them and answered
what you asked. One system, reused across every project.**

## What it is, plainly

A stack of cards appears when someone opens one of your sites. They tap through
one at a time. They cannot get into the site until they are done.

Some cards just tell them something. Others ask for something: pick an option,
type an answer, paste a link, tick a box. Answers are saved as they go, so
closing the tab loses nothing and they come back where they left off.

You open an admin page on that site and see who finished, who did not, and what
everyone said.

## Why it exists

Two live needs that turn out to be the same machine.

**Class sites.** Information has to reach students, and students have to do
things. Read the guidelines. Confirm you read them. Pick your section. Send me a
link. Right now none of that is enforceable, so it does not happen.

**Formula 5.** A personalised midseason recap, ten cards, different numbers for
each of 48 players. Already built once as a one-off at
`~/Projects/formula5-picks/src/Recap.jsx`.

The cards are always bespoke. **The shell, the storage, the gate and the admin
view never are.**

## Who it is for

Andrew, across his own projects. Single developer, no team, no external
consumers. Optimise for how fast the second and third deck ship.

## The shape

Three pieces, in order of how much they matter.

**1. A Supabase schema.** Decks, cards, responses, progress. This is the real
artifact. Get it right and the rest is screens on top.

**2. A React component.** Draws the cards, runs the gate, saves as it goes.

**3. An admin section.** A mountable component each site drops into its own
dashboard.

## Settled decisions

**Identity is the host app's problem.** Stories takes a `viewer` prop: an id and
a display name. It does not care where that came from. The class sites pass a
Supabase Auth user (email, magic link, code fallback, same as the PCA league
site). F5 passes the name the player picked from a list. **This is the single
decision that lets one system serve both.**

**Group membership is also the host app's problem.** The host tells Stories
which groups this viewer belongs to. Stories answers what they still owe. It
never needs to know what a roster is.

**One saved row per card, per viewer.** Makes "who picked B on card 3" a plain
query and makes resume nearly free.

**Every card is required.** Advancing past a card that asks something needs a
valid answer.

**Branching exists.** A card can send the viewer to a specific next card based on
their answer. Default is straight through.

**Two pending decks run back to back.** The gate queues them.

**No escape hatch.** They have to finish. No expiry, no skip.

**Students cannot edit answers.** You can, on the back end.

**Links, not files.** A text field and a URL. No Supabase Storage, no buckets, no
size limits.

**Answers can be handed off.** Stories always writes to its own responses table,
and also fires `onAnswer` so the host app can mirror it into a real table where
that matters. "Pick your section" probably belongs in enrolments, not in a blob.
Storing both means nothing is ever lost to a handler that failed.

**Preview as yourself or as any named student.**

**No email, no notifications.** Chasing people is out of scope and would mean a
mail provider none of these projects have.

## Card types

`read` · `acknowledge` (tick) · `pick one` · `pick many` · `free text` ·
`link` · `external link` · `custom`

`custom` renders a component the host app registered by name. This is how F5's
ladder flythrough and team board survive in a system that otherwise stores cards
as data.

## Authoring: code first, dashboard second

**Phase 1, code.** Decks are defined in the host project. Fast to build, full
freedom, no UI to write.

**Phase 2, dashboard.** The plain card types get editable in the admin section.
Roughly six types with a handful of fields each, so this is a couple of days of
work, not a Typeform.

A dashboard that can build *any* deck is a product of its own and is not the
goal. A dashboard that can build the *guidelines* deck is easy. The `custom`
escape hatch is what keeps both true at once, and it has to be designed in from
day one even though the dashboard is not.

## Integration target

One wrapper per project:

```jsx
<StoriesGate
  viewer={{ id: player.id, name: player.name }}
  groups={["f5:all", `f5:${player.division}`]}
  registry={{ ladder: Ladder, board: Board }}
  onAnswer={(card, value) => mirrorSomewhere(card, value)}
>
  <App />
</StoriesGate>
```

It renders whatever is pending, then gets out of the way.

## The first deck

Class guidelines. Nine cards, best guess, to be confirmed:

| | Card | Type |
|---|---|---|
| 1 | Welcome. Five minutes on how this class works. | read |
| 2 | How you will be graded | read |
| 3 | The three deadlines that matter | read |
| 4 | Late work policy | read |
| 5 | AI policy | read |
| 6 | Confirm you have read the guidelines | acknowledge |
| 7 | What do you want out of this class? | free text |
| 8 | Pick your section | pick one |
| 9 | You are set. See you Thursday. | read |

Card 7 is what stops it reading as a form, and it gives you something worth
reading back.

## Proposed stack

**React 18+ as a peer dependency.** Every target project is React.

**Vite in library mode.** Already the build tool here, and library mode is a
config block rather than a new tool.

**Plain JSX with JSDoc types.** Matches existing project style, no new syntax,
still emits `.d.ts` so the call site gets autocomplete.

**Inline styles from a token object.** How `theme.js` and `theme.vegas.js`
already work. For a library it also sidesteps CSS import order entirely.

**Supabase JS as a peer dependency.** Every consuming project already has it.

**esbuild plus react-dom/server for tests.** The F5 smoke script works this way
and has caught real bugs a build cannot. No test framework unless something
demands one.

**Ship the SQL.** Recommendation, since this was the open question: the package
includes migration files creating `stories_*` tables and their RLS policies, run
once per project. Writing the schema fresh in each app guarantees the three
copies drift, and the schema is the whole point. Host apps still own the tables
in their own database and can alter them; they just do not have to invent them.

## Things that will bite

**RLS will swallow writes silently.** A policy mismatch fails with no error, and
this system writes on every card. Every write appends `.select()` and surfaces
failures loudly. This is already a documented gotcha in the F5 codebase and it
will be worse here, because a lost answer looks exactly like a student who never
answered.

**A blocking interstitial with no keyboard path is a trap.** Keyboard
navigation, focus management and `prefers-reduced-motion` are day one, not
polish. "They have to finish" makes accessibility a correctness requirement, not
a nicety.

**Branching plus every-card-required plus resume is where the bugs will live.**
Position is not a count once cards can be skipped, so progress needs to record
an actual card, and a changed deck needs a defined behaviour for someone
mid-flight.

## Open questions

**Package name.** `@ishak/stories` collides with a lot. Worth five minutes.

**What happens when you edit a live deck?** Someone is on card 4 of 9 and you
change card 6. Do they see the new one, or a snapshot of what they started?

**Does the F5 recap get retrofitted, and when?** It is a *first-half* recap and
round 12 is next, so it has a shelf life. Ship it as a one-off now and convert
later, or make it the first consumer and accept the delay.

## Reference

`~/Projects/formula5-picks/src/Recap.jsx`, the working ten-card deck this
generalises from, and `scripts/smoke-recap.jsx`, the headless harness worth
copying. Both uncommitted on the `vegas-second-half` branch as of 2026-08-12.

Vocabulary: the **format** is a story (tap-through cards, after Instagram and
Snapchat). A personalised data recap is a **Wrapped**. Gating an app behind one
makes it an **interstitial**. Commercially this category is **in-app messaging**,
and the unit is a **campaign** configured by trigger, audience, frequency and
dismissal.
