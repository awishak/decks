// The way back into a game a student has finished.
//
// Andrew, 2026-09-22: "there should be a way back into the questions", and
// "just want them to see their answers and if they were right or not". So this
// is their own paper handed back: every question in order, what they put, and
// a tick or a cross. Nobody else's answers are here, and neither is how the
// class did.
//
// What the screen can say depends on what the host has let out:
//   nothing released   their answers, and no verdict on any of them
//   answers released   the tick or the cross, and the right answer where they
//                      missed, because the key is readable then and not before
//   scores released    the number at the top as well
//
// A multiple choice question comes back whole: every option in the order they
// saw it, the right one green with a tick, their own in bold, and a cross on
// theirs when they missed. Andrew, 2026-09-22.
//
// Like QuizDeck, this knows nothing about Supabase: rows in, screen out.

import { useMemo, useState, useEffect } from "react";
import { DEFAULT_THEME, SIZE, TAP } from "../tokens.js";
import { isRight, isDenial } from "./score.js";
import { loadReview } from "./store.js";

const LETTERS = "ABCDEFGHIJ";

const Tick = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{ flex: "none" }}>
    <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Cross = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{ flex: "none" }}>
    <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

// What they put, in words. A choice answer is held as the option's number.
const answerText = (card, value) => {
  if (value === null || value === undefined || value === "") return "";
  if (card.config?.answer === "typed") return String(value);
  const i = Number(value);
  const option = (card.config?.options || [])[i];
  return option === undefined ? String(value) : `${LETTERS[i]} · ${option}`;
};

// The answer the key holds, in the same words.
const rightText = (card, correct = []) => {
  if (!correct.length) return "";
  if (card.config?.answer === "typed") return correct.map(String).join(" or ");
  return correct
    .filter(c => Number.isInteger(c))
    .map(i => answerText(card, i))
    .join(" or ");
};

// One answer on the sheet: the mark, then the words. The mark keeps its own
// column so the text of every line starts in the same place.
const Line = ({ T, mark, bold, color, children }) => (
  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
    <span style={{ flex: "none", width: 18, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {mark === "tick" ? <Tick size={16} color={T.ok} /> : mark === "cross" ? <Cross size={16} color={T.late} /> : null}
    </span>
    <span style={{ fontSize: SIZE.body, lineHeight: 1.35, fontWeight: bold ? 600 : 400, color }}>{children}</span>
  </div>
);

/**
 * @param {string}   title    The game's name.
 * @param {object[]} cards    Question cards in order.
 * @param {object}   mine     { [cardId]: { value, review } } this viewer's answers.
 * @param {object}   keys     { [cardId]: [correct, ...] }, empty until answers are released.
 * @param {object[]} accepts  [{ card_id, value }] answers the host took later.
 * @param {object}   result   { right, answered } once scores are released, else null.
 * @param {function} onExit   Back to the class.
 * @param {object}   theme    Token overrides; hosts pass their accent.
 */
export default function GameReview({ title, cards = [], mine = {}, keys = {}, accepts = [], result, onExit, theme }) {
  const T = useMemo(() => ({ ...DEFAULT_THEME, ...theme }), [theme]);
  const answersOut = Object.keys(keys).length > 0;

  const acceptedFor = useMemo(() => {
    const out = {};
    accepts.forEach(a => { if (!isDenial(a.value)) (out[a.card_id] ||= []).push(a.value); });
    return out;
  }, [accepts]);

  return (
    <div className="deck-review" style={{
      minHeight: "100dvh", background: T.bg, color: T.text, fontFamily: T.font,
      maxWidth: 560, margin: "0 auto", padding: "24px 20px 120px", boxSizing: "border-box",
      display: "flex", flexDirection: "column", gap: 20,
    }}>
      <style>{`.deck-review,.deck-review *{box-sizing:border-box}
.deck-review button:focus-visible{outline:2px solid ${T.accent};outline-offset:2px}`}</style>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
        <h1 style={{ margin: 0, fontSize: SIZE.head, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.2 }}>{title}</h1>
        {result ? (
          <span style={{ flex: "none", fontFamily: T.mono, fontSize: SIZE.lead }}>{result.right} / {result.answered}</span>
        ) : null}
      </div>

      {answersOut ? null : (
        <p style={{ margin: 0, fontSize: SIZE.small, color: T.dim, lineHeight: 1.45 }}>
          Your answers, as you sent them. The right answers are not out yet.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {cards.map((card, i) => {
          const row = mine[card.id] || null;
          const value = row ? row.value : null;
          const gave = answerText(card, value);
          const correct = keys[card.id] || [];
          const taken = acceptedFor[card.id] || [];
          const right = answersOut && gave ? isRight(value, correct, taken) : null;
          const typed = card.config?.answer === "typed";
          // Which options the key calls right, so the list can mark them.
          const rightOnes = new Set([...correct, ...taken].filter(Number.isInteger));
          const key = rightText(card, correct);
          return (
            <div key={card.id} style={{ background: T.panel, borderRadius: T.radiusLarge, boxShadow: `0 0 0 1px ${T.line}`, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <span style={{ flex: "none", fontFamily: T.mono, fontSize: SIZE.small, color: T.faint, lineHeight: 1.35 }}>{i + 1}</span>
                <span style={{ fontSize: SIZE.body, fontWeight: 600, lineHeight: 1.35 }}>{card.config?.text}</span>
              </div>

              {typed ? (
                // Nothing was on offer, so their words stand on their own.
                <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 26 }}>
                  <Line T={T} mark={right === null ? null : right ? "tick" : "cross"} bold
                    color={right === true ? T.ok : gave ? T.text : T.faint}>
                    {gave || "No answer"}
                  </Line>
                  {right === false && key ? (
                    <Line T={T} mark="tick" color={T.ok}>{key}</Line>
                  ) : null}
                </div>
              ) : (
                // Every option, in the order they saw them: the right one green
                // with a tick, theirs in bold, a cross on theirs when it missed.
                <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 26 }}>
                  {(card.config?.options || []).map((option, n) => {
                    const theirs = value !== null && value !== undefined && Number(value) === n;
                    const isKey = answersOut && rightOnes.has(n);
                    return (
                      <Line key={n} T={T} bold={theirs}
                        mark={isKey ? "tick" : theirs && right === false ? "cross" : null}
                        color={isKey ? T.ok : theirs ? T.text : T.dim}>
                        {LETTERS[n]} · {option}
                      </Line>
                    );
                  })}
                  {gave ? null : (
                    <span style={{ fontSize: SIZE.small, color: T.faint }}>No answer</span>
                  )}
                </div>
              )}

              {row?.review ? (
                <div style={{ paddingLeft: 26, fontSize: SIZE.micro, color: T.faint }}>
                  You asked for a review of this one.
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {onExit ? (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: T.bg, boxShadow: `0 -1px 0 ${T.line}` }}>
          <div style={{ maxWidth: 560, margin: "0 auto", padding: "12px 20px 28px" }}>
            <button type="button" onClick={onExit}
              style={{ width: "100%", minHeight: 52, border: "none", borderRadius: T.radius, fontFamily: T.font, fontSize: SIZE.label, fontWeight: 600, background: T.accent, color: "#ffffff", cursor: "pointer" }}>
              Done
            </button>
          </div>
        </div>
      ) : null}
      <div style={{ minHeight: TAP }} />
    </div>
  );
}

/**
 * The same screen, wired to the database: reads the game, this viewer's
 * answers, and the key if it is out. One read, on open.
 */
export function GameReviewLive({ supabase, deckId, viewer, title, result, theme, onExit, onError }) {
  const [state, setState] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const out = await loadReview(supabase, { deckId, viewerId: viewer?.id });
        if (alive) setState(out);
      } catch (e) { onError?.(e); if (alive) setState(null); }
    })();
    return () => { alive = false; };
  }, [supabase, deckId, viewer?.id, onError]);

  if (!state) {
    const T = { ...DEFAULT_THEME, ...theme };
    return (
      <div style={{ minHeight: "100dvh", background: T.bg, color: T.faint, fontFamily: T.font, display: "flex", alignItems: "center", justifyContent: "center", fontSize: SIZE.body }}>
        {title || "·"}
      </div>
    );
  }

  return (
    <GameReview title={title || state.deck.title} cards={state.cards} mine={state.mine} keys={state.keys}
      accepts={state.accepts} result={result} theme={theme} onExit={onExit} />
  );
}
