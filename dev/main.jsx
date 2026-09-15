// Local preview of a game on a phone, with no database: GameDeck runs against
// the fake Supabase client, seeded with a real spring game. Every Submit goes
// through the same store functions a class site uses.
//
//   npm run dev            then open the address it prints
//   /dev/                  Week 1, multiple choice, 20 minutes (the default)
//   /dev/?game=week7       Week 7 Trivia, typed, a team phone names its team
//   /dev/panel.html        the game panel, with a pretend class and this phone beside it
//
// Inside the panel page, the phone uses the panel's world, so its answers land
// in the rows the panel is watching. Reload to start over.

import { createRoot } from "react-dom/client";
import GameDeck from "../src/games/GameDeck.jsx";
import { makeWorld, ME } from "./world.js";

const which = new URLSearchParams(location.search).get("game") === "week7" ? "week7" : "week1";
let shared = null;
try { shared = window.parent !== window ? window.parent.previewWorld : null; } catch { shared = null; }
const world = shared || makeWorld(which);
window.previewTables = world.sb.tables;   // look in the console: every saved answer is its own row

const roster = which === "week7"
  ? [ME, { id: "f@scu.edu", name: "Teammate one" }, { id: "g@scu.edu", name: "Teammate two" }]
  : world.roster;

createRoot(document.getElementById("root")).render(
  <GameDeck supabase={world.sb} deckId={world.deckId} viewer={ME} roster={roster} onError={e => console.error(e)} />,
);
