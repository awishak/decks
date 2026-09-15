// Local preview of the games home: the sidebar, the table of games with their
// stats, setup and the panel, on a fake database holding the spring Week 1
// game (closed, with every answer) and a draft.
//
//   /dev/games.html

import { createRoot } from "react-dom/client";
import GamesHome from "../src/games/GamesHome.jsx";
import { fakeSupabase } from "../scripts/fake-supabase.js";
import { week1 } from "../scripts/fixtures/spring.js";

const ran = "2026-04-02T17:00:00Z";
const cards = week1.questions.map((q, i) => ({ id: `w1-${i}`, key: `q${i + 1}`, type: "question", position: i, deck_id: "week1", config: { text: q.text, answer: "choice", options: q.options } }));
const students = [...new Set(week1.responses.map(r => r[0]))];
const sb = fakeSupabase({
  tables: {
    decks: [
      { id: "draft", title: "Week 3", group_key: "comm118", kind: "game", teams: "none", published: false, created_at: "2026-09-15T00:00:00Z" },
      { id: "week1", title: "Week 1", group_key: "comm118", kind: "game", teams: "none", published: true, opened_at: ran, closed_at: ran, created_at: ran },
    ],
    deck_cards: cards,
    deck_keys: week1.questions.map((q, i) => ({ deck_id: "week1", card_id: `w1-${i}`, correct: [q.correct] })),
    deck_accepts: [],
    deck_responses: week1.responses.map(([s, qi, v], n) => ({ id: `r${n}`, deck_id: "week1", card_id: `w1-${qi}`, viewer_id: s, answer: { value: v } })),
    deck_progress: students.map(s => ({ deck_id: "week1", viewer_id: s, completed_at: ran })),
    deck_teams: [], deck_extra_time: [],
  },
  unique: { deck_responses: ["card_id", "viewer_id"] },
});
const roster = [...students, "s29", "s30"].map((id, i) => ({ id, name: `Student ${i + 1}` }));

createRoot(document.getElementById("root")).render(
  <GamesHome supabase={sb} groupKey="comm118" context="COMM 118" roster={roster}
    places={(d) => (d.id === "draft" ? ["Wed, Sep 30"] : [])} onError={e => console.error(e)} />,
);
