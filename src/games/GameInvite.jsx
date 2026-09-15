// How a game reaches a student: the host presses Open, and a card comes up
// over the class site with the game's name, a box to tick, and Start.
//
// Andrew's words on the box: "I agree not to leave this window during this
// event". Start waits for it. Start opens the game over the whole screen; the
// done screen has a way back to the class.
//
// Pieces, so a host app can place them:
//   useOpenGames   the games open to this viewer right now, checked every few seconds
//   GameStart      the card with the box and Start
//   GamePlay       the game itself, over the whole screen
//   GamesNow       the same games as a short list, for a page's community section

import { useMemo, useState, useEffect, useCallback } from "react";
import { DEFAULT_THEME, SIZE, TAP } from "../tokens.js";
import GameDeck from "./GameDeck.jsx";

export const AGREEMENT = "I agree not to leave this window during this event";

/**
 * Games this viewer can play or has played, for a group.
 * Each: { deck, questions, done, score } where score is { right, answered } once released.
 */
export function useOpenGames({ supabase, groupKey, viewerId, section = null, every = 8000 }) {
  const [games, setGames] = useState([]);

  const refresh = useCallback(async () => {
    if (!supabase || !groupKey || !viewerId) return;
    try {
      const res = await supabase.from("decks").select("*").eq("group_key", groupKey).eq("kind", "game").eq("published", true);
      if (res.error) return;
      // A run opened to one section is not for the other section's students.
      const decks = (res.data || []).filter(d => d.kind === "game" && d.opened_at && (!d.section || !section || d.section === section));
      if (!decks.length) { setGames([]); return; }
      const ids = decks.map(d => d.id);
      const [cards, progress, extra] = await Promise.all([
        supabase.from("deck_cards").select("id, deck_id, type").in("deck_id", ids).is("retired_at", null),
        supabase.from("deck_progress").select("deck_id, viewer_id, completed_at").in("deck_id", ids),
        supabase.from("deck_extra_time").select("deck_id, viewer_id, minutes").in("deck_id", ids),
      ]);
      const out = [];
      for (const d of decks) {
        const mine = (progress.data || []).filter(p => p.deck_id === d.id);
        const done = mine.some(p => p.completed_at);
        const letIn = (extra.data || []).some(x => x.deck_id === d.id && x.viewer_id === viewerId);
        const open = (!d.closed_at && (!d.closes_at || Date.now() < Date.parse(d.closes_at))) || letIn;
        if (!open && !done && !d.scores_released_at) continue;
        let score = null;
        if (d.scores_released_at && typeof supabase.rpc === "function") {
          const r = await supabase.rpc("deck_scores", { d: d.id });
          const row = (r.data || [])[0];
          if (row) score = { right: row.right_count, answered: row.answered };
        }
        out.push({ deck: d, questions: (cards.data || []).filter(c => c.deck_id === d.id && c.type === "question").length, done, open: open && !done, score });
      }
      setGames(out);
    } catch { /* a missed check is caught by the next one */ }
  }, [supabase, groupKey, viewerId, section]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, every);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, [refresh, every]);

  return { games, refresh };
}

const facts = (g) => [g.questions ? `${g.questions} ${g.questions === 1 ? "question" : "questions"}` : null, g.deck.time_limit_min ? `${g.deck.time_limit_min} min` : null].filter(Boolean).join(" · ");

/** The card over the site: the game's name, the box, Start. */
export function GameStart({ game, onStart, theme }) {
  const T = useMemo(() => ({ ...DEFAULT_THEME, ...theme }), [theme]);
  const [agreed, setAgreed] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-label={game.deck.title}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(28,25,23,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: T.font }}>
      <div style={{ width: "100%", maxWidth: 440, background: T.panel, color: T.text, borderRadius: 20, padding: 28, display: "flex", flexDirection: "column", gap: 20, boxShadow: "0 30px 80px -30px rgba(0,0,0,.6)", boxSizing: "border-box" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: SIZE.head, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.2 }}>{game.deck.title}</span>
          {facts(game) ? <span style={{ fontFamily: T.mono, fontSize: SIZE.small, color: T.dim }}>{facts(game)}</span> : null}
        </div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 12, minHeight: TAP, fontSize: SIZE.body, lineHeight: 1.4, cursor: "pointer" }}>
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
            style={{ width: 24, height: 24, marginTop: 1, flex: "none", accentColor: T.accent }} />
          {AGREEMENT}
        </label>
        <button type="button" disabled={!agreed} onClick={() => onStart(game)}
          style={{ minHeight: 52, border: "none", borderRadius: T.radius, fontFamily: T.font, fontSize: SIZE.label, fontWeight: 600,
            background: agreed ? T.accent : T.line, color: agreed ? "#ffffff" : T.dim, cursor: agreed ? "pointer" : "default" }}>
          Start
        </button>
      </div>
    </div>
  );
}

/** The game over the whole screen, with a way back once it is done. */
export function GamePlay({ supabase, game, viewer, roster, theme, onExit, onError }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, overflowY: "auto", background: (theme?.bg) || DEFAULT_THEME.bg }}>
      <GameDeck supabase={supabase} deckId={game.deck.id} viewer={viewer} roster={roster} theme={theme} onError={onError} onExit={onExit} />
    </div>
  );
}

/** The open and finished games as a short list, for a community section. */
export function GamesNow({ games, onStart, theme }) {
  const T = useMemo(() => ({ ...DEFAULT_THEME, ...theme }), [theme]);
  if (!games.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, fontFamily: T.font }}>
      {games.map(g => (
        <div key={g.deck.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, borderRadius: T.radiusLarge, background: T.panel, boxShadow: `0 0 0 1px ${T.line}` }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: SIZE.body, fontWeight: 600 }}>{g.deck.title}</span>
            {g.open && facts(g) ? <span style={{ fontFamily: T.mono, fontSize: SIZE.micro, color: T.dim }}>{facts(g)}</span> : null}
          </div>
          {g.open ? (
            <button type="button" onClick={() => onStart(g)}
              style={{ minHeight: TAP, padding: "0 20px", border: "none", borderRadius: T.radius, background: T.accent, color: "#ffffff", fontFamily: T.font, fontSize: SIZE.label, fontWeight: 600, cursor: "pointer" }}>
              Start
            </button>
          ) : g.score ? (
            <span style={{ fontFamily: T.mono, fontSize: SIZE.lead }}>{g.score.right} / {g.score.answered}</span>
          ) : g.done ? (
            <svg width="22" height="22" viewBox="0 0 16 16" aria-label="Done"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke={T.ok} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          ) : null}
        </div>
      ))}
    </div>
  );
}
