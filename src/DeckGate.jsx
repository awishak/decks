// The one component a project wraps its app in.
//
// What it does, in order:
//   1. Asks Supabase whether this viewer owes any decks.
//   2. If they do, renders the first one INSTEAD of your app.
//   3. Saves every answer as it happens.
//   4. Marks the deck finished, then moves to the next pending one.
//   5. When nothing is pending, renders your app and stays out of the way.
//
// Without this, every project writes its own check-fetch-render-save-finish
// loop, which is most of the reason this package exists.
//
//   <DeckGate supabase={sb} viewer={{id, name}} groups={["class:comm101:fa26"]}>
//     <App />
//   </DeckGate>

import { useState, useEffect, useCallback, useRef } from "react";
import Deck from "./Deck.jsx";
import { pendingDecks, loadDeck, saveAnswer, saveProgress, markComplete } from "./store.js";
import { DEFAULT_THEME, SIZE } from "./tokens.js";

/**
 * @param {object}   supabase   A Supabase client. Required.
 * @param {object}   viewer     { id, name }. id is whatever the host uses.
 * @param {string[]} groups     Groups this viewer belongs to. Host decides meaning.
 * @param {object}   data       Per-viewer values for {token} interpolation.
 * @param {object}   registry   Host components for `custom` cards, by name.
 * @param {function} onAnswer   Optional mirror. (card, value) => void.
 * @param {function} onError    Optional. Called with any storage failure.
 * @param {boolean}  failOpen   On a storage error, let them into the app.
 *                              Defaults TRUE: a Supabase blip should not lock
 *                              a whole class out of the site. Set false only if
 *                              the gate matters more than availability.
 * @param {object}   theme      Token overrides passed to Deck.
 */
export default function DeckGate({
  supabase, viewer, groups = [], data = {}, registry = {},
  onAnswer, onError, failOpen = true, theme, children,
}) {
  // Decided synchronously where possible. With no client or no viewer there is
  // nothing to gate, and waiting for an effect to work that out shows a curtain
  // for a frame and breaks server rendering outright.
  const [state, setState] = useState(
    () => (!supabase || !viewer?.id ? "clear" : "loading"),
  );                                               // loading | showing | clear | error
  const [queue, setQueue] = useState([]);
  const [active, setActive] = useState(null);      // { deck, cards, answers }
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const fail = useCallback((e) => {
    onError?.(e);
    if (mounted.current) setState(failOpen ? "clear" : "error");
  }, [onError, failOpen]);

  // Find what is owed. Re-runs if the viewer or their groups change.
  useEffect(() => {
    let cancelled = false;
    if (!supabase || !viewer?.id) { setState("clear"); return; }

    // A viewer arriving late (async auth) must close the curtain BEFORE the
    // lookup, or the app flashes into view and then gets yanked away.
    setState(s => (s === "showing" ? s : "loading"));

    (async () => {
      try {
        const decks = await pendingDecks(supabase, { viewerId: viewer.id, groups });
        if (cancelled || !mounted.current) return;
        if (!decks.length) { setState("clear"); return; }
        setQueue(decks.slice(1));
        const loaded = await loadDeck(supabase, { deckId: decks[0].id, viewerId: viewer.id });
        if (cancelled || !mounted.current) return;
        setActive({ deck: { ...decks[0], cards: loaded.cards }, answers: loaded.answers });
        setState("showing");
      } catch (e) {
        if (!cancelled) fail(e);
      }
    })();

    return () => { cancelled = true; };
  }, [supabase, viewer?.id, groups.join("|"), fail]);

  const handleAnswer = useCallback(async (card, value) => {
    onAnswer?.(card, value);                       // mirror first; never blocked by storage
    if (!active) return;
    try {
      await saveAnswer(supabase, {
        deckId: active.deck.id, cardId: card.id, viewerId: viewer.id, value,
      });
      await saveProgress(supabase, {
        deckId: active.deck.id, viewerId: viewer.id, currentCardId: card.id,
      });
    } catch (e) {
      fail(e);
    }
  }, [active, supabase, viewer?.id, onAnswer, fail]);

  const handleComplete = useCallback(async () => {
    if (!active) return;
    try {
      await markComplete(supabase, { deckId: active.deck.id, viewerId: viewer.id });
    } catch (e) {
      return fail(e);
    }
    if (!mounted.current) return;

    // Two pending decks run back to back.
    const [next, ...rest] = queue;
    if (!next) { setActive(null); setState("clear"); return; }
    try {
      const loaded = await loadDeck(supabase, { deckId: next.id, viewerId: viewer.id });
      if (!mounted.current) return;
      setQueue(rest);
      setActive({ deck: { ...next, cards: loaded.cards }, answers: loaded.answers });
    } catch (e) {
      fail(e);
    }
  }, [active, queue, supabase, viewer?.id, fail]);

  if (state === "loading") return <Curtain theme={theme} />;
  if (state === "clear") return children;
  if (state === "error") return <Curtain theme={theme} message="Couldn't load this right now. Try again in a minute." />;

  return (
    <Deck
      deck={active.deck}
      data={{ name: viewer?.name, ...data }}
      answers={active.answers}
      onAnswer={handleAnswer}
      onComplete={handleComplete}
      registry={registry}
      theme={theme}
    />
  );
}

// Shown while deciding, so the app never flashes into view before the gate
// closes over it. Deliberately almost empty.
function Curtain({ theme, message }) {
  const T = { ...DEFAULT_THEME, ...theme };
  return (
    <div style={{
      minHeight: "100dvh", display: "grid", placeItems: "center",
      background: T.bg, color: T.dim, fontFamily: T.font,
      fontSize: SIZE.body, padding: 30, textAlign: "center",
    }}>
      {message || ""}
    </div>
  );
}
