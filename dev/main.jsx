// Local preview of a game on a phone, with no database: GameDeck runs against
// the fake Supabase client, seeded with a real spring game. Every Submit goes
// through the same store functions a class site uses.
//
//   npm run dev            then open the address it prints
//   ?game=week1            Week 1, multiple choice, 20 minutes (the default)
//   ?game=week7            Week 7 Trivia, typed, a team phone names its team
//
// Reload to start over.

import { createRoot } from "react-dom/client";
import GameDeck from "../src/games/GameDeck.jsx";
import { fakeSupabase } from "../scripts/fake-supabase.js";
import { week1, week7 } from "../scripts/fixtures/spring.js";

const which = new URLSearchParams(location.search).get("game") === "week7" ? "week7" : "week1";
const me = { id: "you@scu.edu", name: "You" };

const decks = {
  week1: {
    deck: { id: "week1", title: week1.title, kind: "game", teams: "none", time_limit_min: 20, opened_at: new Date().toISOString() },
    cards: week1.questions.map((q, i) => ({ id: `w1-${i}`, key: `q${i + 1}`, type: "question", position: i, deck_id: "week1",
      config: { text: q.text, answer: "choice", options: q.options } })),
  },
  week7: {
    deck: { id: "week7", title: week7.title, kind: "game", teams: "phone", time_limit_min: null, opened_at: new Date().toISOString() },
    cards: week7.questions.map((q, i) => ({ id: `w7-${i}`, key: `t${i + 1}`, type: "question", position: i, deck_id: "week7",
      config: { text: q.text, answer: "typed" } })),
  },
};

const { deck, cards } = decks[which];
const sb = fakeSupabase({
  tables: { decks: [deck], deck_cards: cards, deck_responses: [], deck_progress: [], deck_teams: [], deck_extra_time: [] },
  unique: { deck_responses: ["card_id", "viewer_id"] },
});
window.previewTables = sb.tables;   // look in the console: every saved answer is its own row

const roster = [me, { id: "f@scu.edu", name: "Teammate one" }, { id: "g@scu.edu", name: "Teammate two" }];

createRoot(document.getElementById("root")).render(
  <GameDeck supabase={sb} deckId={deck.id} viewer={me} roster={roster} onError={e => console.error(e)} />,
);
