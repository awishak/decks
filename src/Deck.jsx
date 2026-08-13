// The deck shell: layout, navigation, the button, and nothing else.
//
// Two rules it exists to hold, both learned from the Formula 5 recap:
//
//   1. Centring is defined HERE, on both axes, once. Never per card.
//   2. Headline first. Card bodies open with their takeaway; the shell does not
//      add chrome above it.
//
// It does not know about Supabase. It takes answers in and reports them out, so
// it renders identically in a test and in the browser.

import { useState, useMemo, useEffect, useCallback } from "react";
import { CARD_TYPES } from "./cards/index.jsx";
import { DEFAULT_THEME, SIZE } from "./tokens.js";
import { liveCards, nextCard, isSatisfied, resumeAt, interpolate } from "./resolve.js";

/**
 * @param {object}   deck        A deck with a `cards` array.
 * @param {object}   data        Per-viewer values for `{token}` interpolation.
 * @param {object}   answers     Stored answers, keyed by card key.
 * @param {function} onAnswer    (card, value) => void. Fires on every change.
 * @param {function} onComplete  Called once the last card is passed.
 * @param {object}   registry    Host components for `custom` cards, by name.
 * @param {object}   theme       Token overrides.
 * @param {string}   startAt     Card key to open on. Defaults to the resume point.
 */
export default function Deck({
  deck, data = {}, answers = {}, onAnswer, onComplete,
  registry = {}, theme, startAt,
}) {
  const T = useMemo(() => ({ ...DEFAULT_THEME, ...theme }), [theme]);
  const cards = useMemo(() => liveCards(deck), [deck]);

  const [key, setKey] = useState(
    () => startAt || resumeAt(deck, answers)?.key || cards[0]?.key,
  );
  const [local, setLocal] = useState(answers);
  const [beat, setBeat] = useState(0);

  const card = cards.find(c => c.key === key) || cards[0];
  const answer = local[card?.key];
  const beats = card?.beats || [];
  const onLastBeat = beat >= beats.length;

  const record = useCallback((value) => {
    setLocal(a => ({ ...a, [card.key]: value }));
    onAnswer?.(card, value);
  }, [card, onAnswer]);

  // A read card is "answered" by being seen, so resume knows it was passed.
  useEffect(() => { setBeat(0); }, [key]);

  if (!card) return null;

  const canAdvance = onLastBeat ? isSatisfied(card, answer) : true;

  const advance = () => {
    if (!onLastBeat) return setBeat(beat + 1);
    if (!isSatisfied(card, answer)) return;
    if (!(card.key in local)) record(true);          // mark a read card as seen
    const next = nextCard(deck, card.key, answer);
    if (next) setKey(next.key);
    else onComplete?.();
  };

  const back = () => {
    if (beat > 0) return setBeat(beat - 1);
    const i = cards.findIndex(c => c.key === card.key);
    if (i > 0) setKey(cards[i - 1].key);
  };

  const Body = CARD_TYPES[card.type];
  const Custom = card.type === "custom" ? registry[card.config?.component] : null;
  const BeatBody = beat > 0 ? registry[beats[beat - 1]?.component] : null;

  const pos = cards.findIndex(c => c.key === card.key);
  const nextLabel = !onLastBeat
    ? (card.nextLabel || "Continue")
    : (card.nextLabel && beats.length === 0 ? card.nextLabel : "Next");

  return (
    <div style={{ background: T.bg, minHeight: "100dvh", position: "relative" }}>
      {/* Progress. Read-only: the button is the tap target. */}
      <div style={{ position: "fixed", top: 18, left: 0, right: 0, zIndex: 5,
        display: "flex", gap: 5, justifyContent: "center", padding: "0 20px" }}>
        {cards.map((c, n) => (
          <div key={c.key} style={{ height: 3, flex: 1, maxWidth: 34, borderRadius: 2,
            background: n <= pos ? T.accent : T.line }} />
        ))}
      </div>

      {/* The shell. Centring lives here and nowhere else. */}
      <div style={{
        minHeight: "100dvh", width: "100%", maxWidth: 540, margin: "0 auto",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        textAlign: "center", gap: 20, padding: "84px 20px 112px",
        fontFamily: T.font, color: T.text,
      }}>
        {Custom
          ? <Custom config={card.config} data={data} T={T} answer={answer} onAnswer={record} />
          : Body
            ? <Body config={card.config} data={data} answer={answer} onAnswer={record} T={T} />
            : <div style={{ fontSize: SIZE.body, color: T.dim }}>Unknown card type: {card.type}</div>}

        {beat > 0 && (BeatBody
          ? <BeatBody config={beats[beat - 1]} data={data} T={T} />
          : <div style={{ fontFamily: T.font, fontWeight: 600, fontSize: SIZE.head,
              lineHeight: 1.28, maxWidth: 480 }}>
              {interpolate(beats[beat - 1]?.head, data)}
            </div>)}
      </div>

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 5,
        padding: "14px 20px 22px", display: "flex", gap: 10, justifyContent: "center",
        background: `linear-gradient(transparent, ${T.bg} 42%)` }}>
        {(pos > 0 || beat > 0) && (
          <button type="button" onClick={back} aria-label="Back" style={{
            ...btn(T), padding: "14px 17px", background: "transparent",
            color: T.dim, border: `1px solid ${T.line}` }}>←</button>
        )}
        <button type="button" onClick={advance} disabled={!canAdvance} style={{
          ...btn(T), opacity: canAdvance ? 1 : 0.4,
          cursor: canAdvance ? "pointer" : "not-allowed" }}>
          {nextLabel}
        </button>
      </div>
    </div>
  );
}

const btn = T => ({
  fontFamily: T.font, fontSize: SIZE.label, fontWeight: 700, letterSpacing: "0.03em",
  padding: "14px 28px", borderRadius: 999, cursor: "pointer",
  border: `1px solid ${T.accent}`, background: T.accent, color: "#fff",
});
