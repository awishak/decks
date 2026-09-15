// QuizDeck wired to the database: load the game, start the clock, save each
// Submit as its own row, and stop when the game stops taking answers.
//
//   <GameDeck supabase={sb} deckId={id} viewer={{ id: email, name }} roster={students} />
//
// A viewer's id is their lowercased sign-in email, the same value the
// database's rules compare against (deck_viewer() in 003_games.sql).

import { useState, useEffect, useCallback } from "react";
import QuizDeck, { TeamStart } from "./QuizDeck.jsx";
import { loadGame, startGame, submitAnswer, moveTo, finishGame, createTeam } from "./store.js";
import { DEFAULT_THEME, SIZE } from "../tokens.js";

export default function GameDeck({ supabase, deckId, viewer, roster = [], theme, onError }) {
  const [game, setGame] = useState(null);      // what loadGame returns
  const [state, setState] = useState("loading"); // loading | ready | missing
  const [over, setOver] = useState(false);

  const load = useCallback(async () => {
    try {
      const g = await loadGame(supabase, { deckId, viewerId: viewer.id });
      if (!g) { setState("missing"); return; }
      const needsTeam = g.deck.teams === "phone" && !g.team;
      const closed = !!g.deck.closed_at && !g.extra;
      if (!needsTeam && !closed && !g.progress) {
        try { g.progress = await startGame(supabase, { deckId, viewerId: g.speaksAs }); }
        catch (e) { setOver(true); onError?.(e); }
      }
      setOver(o => o || closed);
      setGame(g);
      setState("ready");
    } catch (e) {
      onError?.(e);
      setState("missing");
    }
  }, [supabase, deckId, viewer?.id, onError]);

  useEffect(() => { if (supabase && viewer?.id) load(); }, [load, supabase, viewer?.id]);

  const onSubmit = useCallback(async (card, value, review) => {
    try {
      await submitAnswer(supabase, { deckId, cardId: card.id, viewerId: game.speaksAs, value, review });
    } catch (e) {
      // Already answered (another tab, a double tap): take what is saved and move on.
      if (e.code === "23505") { await load(); return; }
      // The game will not take it: closed or out of time.
      if (e.code === "refused" || e.code === "42501") { setOver(true); return; }
      onError?.(e);
      throw e;   // keeps the question up with "Not saved"
    }
    const i = game.cards.findIndex(c => c.id === card.id);
    const next = game.cards[i + 1];
    try {
      if (next) await moveTo(supabase, { deckId, viewerId: game.speaksAs, cardId: next.id });
      else await finishGame(supabase, { deckId, viewerId: game.speaksAs });
    } catch (e) {
      onError?.(e);   // the answer is saved; progress is only the resume point
    }
  }, [supabase, deckId, game, load, onError]);

  const T = { ...DEFAULT_THEME, ...theme };
  if (state !== "ready") {
    return <div style={{ minHeight: "100dvh", background: T.bg, fontFamily: T.font, fontSize: SIZE.body, color: T.dim }} />;
  }

  const { deck, cards, team, answered, progress, extra } = game;
  if (deck.teams === "phone" && !team && !over) {
    return (
      <TeamStart title={deck.title} roster={roster} viewerId={viewer.id} theme={theme}
        onStart={async (name, members) => { await createTeam(supabase, { deckId, name, members }); await load(); }} />
    );
  }

  // Someone let in later runs on the minutes they were given, from when they started.
  const limitMin = extra ? extra.minutes : deck.time_limit_min;
  const startedAt = extra && progress
    ? new Date(Math.max(new Date(progress.started_at).getTime(), new Date(extra.granted_at).getTime())).toISOString()
    : progress?.started_at;

  return (
    <QuizDeck title={deck.title} cards={cards} answered={answered} teamName={team?.name}
      startedAt={startedAt} limitMin={limitMin} over={over} onSubmit={onSubmit} theme={theme} />
  );
}
