// Walks both real decks end to end and fails loudly.
//
// Three jobs, in order of how much they have already earned their place:
//
//   1. Assert the pure logic: branching, resume, and every-card-required. This
//      is where the bugs live, and none of it needs a DOM.
//   2. Render every card through react-dom/server. A build cannot catch an
//      undefined identifier; it compiles clean and throws in the browser.
//   3. Enforce the 13px type floor, because a comment saying "13px floor" is
//      what failed last time.

import { renderToString } from "react-dom/server";
import Deck from "../src/Deck.jsx";
import DeckGate from "../src/DeckGate.jsx";
import { assertFloor } from "../src/tokens.js";
import { liveCards, nextCard, resumeAt, isComplete, isSatisfied } from "../src/resolve.js";
import { pendingDecks, loadDeck, saveAnswer } from "../src/store.js";
import { fakeSupabase } from "./fake-supabase.js";
import { classGuidelines } from "../seeds/class-guidelines.js";
import { f5Midseason } from "../seeds/f5-midseason.js";

let failed = 0;
const check = (label, fn) => {
  try {
    const out = fn();
    if (out === false) throw new Error("returned false");
    console.log(`  ok    ${label}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${label}\n        ${e.message}`);
  }
};

const checkAsync = async (label, fn) => {
  try {
    const out = await fn();
    if (out === false) throw new Error("returned false");
    console.log(`  ok    ${label}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${label}\n        ${e.message}`);
  }
};

// Seeds are authored without explicit positions, so index order is the order.
const withPositions = d => ({ ...d, cards: d.cards.map((c, i) => ({ ...c, position: i })) });
const CG = withPositions(classGuidelines);
const F5 = withPositions(f5Midseason);

console.log("\nlogic");

check("class deck has 10 live cards", () => liveCards(CG).length === 10);

check("branch: auditing skips to the send-off", () =>
  nextCard(CG, "enrolled", "auditing").key === "done");

check("branch: enrolled falls through to the next card", () =>
  nextCard(CG, "enrolled", "enrolled").key === "hopes");

check("branch to a retired card falls through, does not dead-end", () => {
  // Retire the branch target. The viewer must land on the next live card by
  // position, not on nothing, or a mistyped goto strands them in the deck.
  const broken = { ...CG, cards: CG.cards.map(c =>
    c.key === "done" ? { ...c, retired_at: "2026-01-01" } : c) };
  return nextCard(broken, "enrolled", "auditing")?.key === "hopes";
});

check("branch to a card that never existed also falls through", () => {
  const typo = { ...CG, cards: CG.cards.map(c =>
    c.key === "enrolled" ? { ...c, branches: [{ when: "auditing", goto: "no-such-card" }] } : c) };
  return nextCard(typo, "enrolled", "auditing")?.key === "hopes";
});

check("resume: no answers starts at card one", () =>
  resumeAt(CG, {}).key === "welcome");

check("resume: stops at the first unsatisfied required card", () => {
  const answers = { welcome: true, grading: true, deadlines: true,
    "late-work": true, "ai-policy": true };
  return resumeAt(CG, answers).key === "confirm";
});

check("resume: an unticked acknowledge does not count as done", () =>
  resumeAt(CG, { welcome: true, grading: true, deadlines: true, "late-work": true,
    "ai-policy": true, confirm: false }).key === "confirm");

check("resume: replaying a branch skips the branched-over cards", () => {
  const answers = { welcome: true, grading: true, deadlines: true, "late-work": true,
    "ai-policy": true, confirm: true, enrolled: "auditing" };
  return resumeAt(CG, answers).key === "done";
});

check("complete: the auditing path finishes without section or hopes", () =>
  isComplete(CG, { welcome: true, grading: true, deadlines: true, "late-work": true,
    "ai-policy": true, confirm: true, enrolled: "auditing", done: true }));

check("required: blank free text does not satisfy", () =>
  isSatisfied(CG.cards.find(c => c.key === "hopes"), "   ") === false);

check("required: a bare word is not a link", () => {
  const linkCard = { type: "link" };
  return isSatisfied(linkCard, "notaurl") === false
      && isSatisfied(linkCard, "https://example.com/x") === true;
});

check("resume terminates on a branch cycle", () => {
  const loop = withPositions({ cards: [
    { key: "a", type: "pick_one", config: { options: [{ value: "x", label: "x" }] },
      branches: [{ when: "x", goto: "b" }] },
    { key: "b", type: "pick_one", config: { options: [{ value: "y", label: "y" }] },
      branches: [{ when: "y", goto: "a" }] },
  ] });
  return resumeAt(loop, { a: "x", b: "y" }) !== undefined;   // must return, not hang
});

console.log("\ntype floor");
check("no token below 13px", () => assertFloor());

console.log("\nrender");

const registry = {
  TitleCard: () => <div>title</div>,
  Ladder: () => <div>ladder</div>,
  TeamReveal: () => <div>team</div>,
  Round11Result: () => <div>result</div>,
  Board: () => <div>board</div>,
  Breakdown: () => <div>breakdown</div>,
  Contenders: () => <div>contenders</div>,
};

const data = { name: "Sam", first: "Andrew", ppr: 42.6, rankOrdinal: "4th",
  mateFirst: "Kevin", teamName: "Cal Aggie Racing", stakeWas: "a win",
  stakeGot: "You got both.", fairCount: 10, leaderName: "Joe McGlynn" };

for (const [label, deck] of [["class", CG], ["f5", F5]]) {
  for (const card of liveCards(deck)) {
    check(`${label}: ${card.key}`, () => {
      const html = renderToString(
        <Deck deck={deck} data={data} registry={registry} startAt={card.key} />);
      if (!html || html.length < 100) throw new Error(`short output: ${html.length}`);
      return true;
    });
  }
}

check("f5 round11 second beat renders", () => {
  const html = renderToString(
    <Deck deck={F5} data={data} registry={registry} startAt="round11" />);
  return html.length > 100;
});

check("unknown card type degrades instead of throwing", () => {
  const weird = withPositions({ cards: [{ key: "w", type: "nope", config: {} }] });
  return /Unknown card type/.test(renderToString(<Deck deck={weird} />));
});

check("interpolation fills tokens", () => {
  const html = renderToString(<Deck deck={CG} data={data} startAt="welcome" />);
  return /Sam/.test(html) && !/\{name\}/.test(html);
});

check("an unknown token is left visible rather than blanked", () => {
  const html = renderToString(<Deck deck={CG} data={{}} startAt="welcome" />);
  return /\{name\}/.test(html);
});

check("DeckGate renders its curtain without throwing", () => {
  // renderToString does not run effects, so this reaches the loading state only.
  // Still worth it: an undefined identifier in DeckGate compiles clean and only
  // explodes at runtime, which is exactly what a build cannot catch.
  const html = renderToString(
    <DeckGate supabase={fakeSupabase()} viewer={{ id: "v1", name: "Sam" }} groups={["g"]}>
      <div>app</div>
    </DeckGate>);
  return typeof html === "string";
});

check("DeckGate with no viewer renders the app rather than blocking", () => {
  const html = renderToString(
    <DeckGate supabase={fakeSupabase()} viewer={null}><div>app</div></DeckGate>);
  return /app/.test(html);
});

/* ------------------------------------------------------------- storage */

// Wrapped in a function rather than top-level await: the harness bundles to CJS
// so it can run through plain node with no loader flags.
async function storage() {
  console.log("\nstorage");

  const DECKS = [
    { id: "d1", key: "one", group_key: "g", published: true, created_at: "2026-01-01" },
    { id: "d2", key: "two", group_key: "g", published: true, created_at: "2026-02-01" },
  ];

  await checkAsync("pendingDecks returns nothing when the viewer has no groups", async () =>
    (await pendingDecks(fakeSupabase({ tables: { decks: DECKS } }),
      { viewerId: "v1", groups: [] })).length === 0);

  await checkAsync("pendingDecks lists unfinished decks oldest first", async () => {
    const sb = fakeSupabase({ tables: { decks: DECKS, deck_progress: [] } });
    const out = await pendingDecks(sb, { viewerId: "v1", groups: ["g"] });
    return out.length === 2 && out[0].id === "d1";
  });

  await checkAsync("pendingDecks drops decks this viewer already completed", async () => {
    const sb = fakeSupabase({ tables: { decks: DECKS,
      deck_progress: [{ deck_id: "d1", viewer_id: "v1", completed_at: "2026-03-01" }] } });
    const out = await pendingDecks(sb, { viewerId: "v1", groups: ["g"] });
    return out.length === 1 && out[0].id === "d2";
  });

  await checkAsync("pendingDecks ignores another viewer's completion", async () => {
    const sb = fakeSupabase({ tables: { decks: DECKS,
      deck_progress: [{ deck_id: "d1", viewer_id: "SOMEONE_ELSE", completed_at: "2026-03-01" }] } });
    return (await pendingDecks(sb, { viewerId: "v1", groups: ["g"] })).length === 2;
  });

  await checkAsync("loadDeck keys answers by card key, not card id", async () => {
    const sb = fakeSupabase({ tables: {
      deck_cards: [{ id: "c1", deck_id: "d1", key: "confirm", type: "acknowledge", position: 0 }],
      deck_responses: [{ deck_id: "d1", card_id: "c1", viewer_id: "v1", answer: { value: true } }],
    } });
    const { answers } = await loadDeck(sb, { deckId: "d1", viewerId: "v1" });
    return answers.confirm === true && !("c1" in answers);
  });

  await checkAsync("loadDeck skips a response whose card was retired away", async () => {
    const sb = fakeSupabase({ tables: {
      deck_cards: [],
      deck_responses: [{ deck_id: "d1", card_id: "gone", viewer_id: "v1", answer: { value: 1 } }],
    } });
    const { answers } = await loadDeck(sb, { deckId: "d1", viewerId: "v1" });
    return Object.keys(answers).length === 0;
  });

  // The one that matters most. RLS rejecting a write returns no rows and no
  // error, and a lost answer is indistinguishable from a student who never
  // answered. It has to throw.
  await checkAsync("saveAnswer THROWS when RLS silently eats the write", async () => {
    const sb = fakeSupabase({ writeReturnsNothing: true });
    try {
      await saveAnswer(sb, { deckId: "d1", cardId: "c1", viewerId: "v1", value: true });
      return false;
    } catch (e) {
      return /RLS/.test(e.message);
    }
  });

  await checkAsync("saveAnswer surfaces a real Postgres error", async () => {
    const sb = fakeSupabase({ failOn: "deck_responses" });
    try {
      await saveAnswer(sb, { deckId: "d1", cardId: "c1", viewerId: "v1", value: true });
      return false;
    } catch (e) {
      return /boom/.test(e.message);
    }
  });

  await checkAsync("saveAnswer wraps the value so jsonb never gets a bare scalar", async () => {
    const sb = fakeSupabase();
    await saveAnswer(sb, { deckId: "d1", cardId: "c1", viewerId: "v1", value: "b" });
    return sb.calls[0].payload.answer.value === "b";
  });
}

storage().then(() => {
  console.log(failed ? `\n${failed} failed` : `\nall passed`);
  process.exit(failed ? 1 : 0);
});
