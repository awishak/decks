// Local preview of the game panel, live: a pretend class answers a real spring
// game while the panel redraws, and the phone on the right is you, playing
// along in the same game.
//
//   /dev/panel.html               Week 1, multiple choice
//   /dev/panel.html?game=week7    Week 7 Trivia, teams, typed answers
//   &speed=3                      a faster class
//   &phone=0                      the panel alone
//
// Reload to start the class over.

import { createRoot } from "react-dom/client";
import { GamePanelLive } from "../src/games/GamePanel.jsx";
import { makeWorld } from "./world.js";

const params = new URLSearchParams(location.search);
const which = params.get("game") === "week7" ? "week7" : "week1";
const speed = Math.max(0.25, Number(params.get("speed")) || 1);
const phone = params.get("phone") !== "0";

const world = makeWorld(which);
window.previewWorld = world;          // the phone frame below uses this same world
window.previewTables = world.sb.tables;
world.run(speed);

createRoot(document.getElementById("root")).render(
  <div style={{ display: "flex", height: "100vh" }}>
    <div style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
      <GamePanelLive supabase={world.sb} deckId={world.deckId} context="COMM 118" roster={world.roster}
        onError={e => console.error(e)} onScreen={v => console.log("put on screen", v)} />
    </div>
    {phone ? (
      <div style={{ flex: "none", width: 430, background: "#e3ded8", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <iframe title="Phone" src={`./index.html?embed=1&game=${which}`}
          style={{ width: 390, height: "min(844px, calc(100vh - 40px))", border: 0, borderRadius: 28, background: "#fafaf9", boxShadow: "0 24px 60px -24px rgba(28,25,23,.45)" }} />
      </div>
    ) : null}
  </div>,
);
