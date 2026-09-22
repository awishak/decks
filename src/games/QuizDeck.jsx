// The phone side of a game: one question at a time, Submit, no going back.
//
// Drawn from the Game Panel canvas, and from what Andrew decided:
//   Tap selects. Submit locks the answer and moves on. There is no Back.
//   Please review sits in the bottom corner and can be unticked until Submit.
//   Only a submitted answer counts; a tapped one with no Submit is blank.
//   Time left reads "5 min" above a minute, seconds only in the last one.
//   After the last Submit: the game's name, the team, a tick. No score until
//   he releases it.
//
// This component knows nothing about Supabase. It takes the questions and what
// was already answered, and reports each Submit up as a promise, so it renders
// the same in a test, in the local preview and on a phone. GameDeck.jsx is the
// version wired to the database.

import { useState, useEffect, useMemo, useRef } from "react";
import { DEFAULT_THEME, SIZE, TAP } from "../tokens.js";
import { timeLeft, secondsLeft } from "./score.js";

const LETTERS = "ABCDEFGHIJ";

// What the "?" beside Please review says, in Andrew's words (2026-09-22). A
// host with a different name passes its own.
export const REVIEW_NOTE = "Click this box if you would like Dr. Ishak to review the material associated with this question.";

// Padding counts inside a width, or a full-width option runs off a phone's edge.
const QUIZ_CSS = (T) => `.deck-quiz,.deck-quiz *{box-sizing:border-box}
.deck-quiz button:focus-visible,.deck-quiz input:focus-visible+span{outline:2px solid ${T.accent};outline-offset:2px}`;

const Tick = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{ flex: "none" }}>
    <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * @param {string}   title       The game's name, shown when done.
 * @param {object[]} cards       Question cards in order: { id, key, config: { text, image?, answer, options? } }.
 * @param {object}   answered    { [cardKey]: { value, review } } already submitted.
 * @param {string}   teamName    The team this phone answers for, if any.
 * @param {string}   startedAt   When this viewer's clock started (ISO), for a timed game.
 * @param {number}   limitMin    Minutes on the clock, or null for no clock.
 * @param {boolean}  over        The game will take no more answers (closed, or out of time).
 * @param {function} onSubmit    (card, value, review) => Promise. Reject to keep the question up.
 * @param {object}   theme       Token overrides; hosts pass their accent.
 */
export default function QuizDeck({
  title, cards = [], answered = {}, teamName, startedAt, limitMin, over = false,
  onSubmit, theme, now: fixedNow, onExit, result, reviewNote = REVIEW_NOTE,
}) {
  const T = useMemo(() => ({ ...DEFAULT_THEME, ...theme }), [theme]);
  const [done, setDone] = useState(() => new Set(Object.keys(answered)));
  useEffect(() => { setDone(new Set(Object.keys(answered))); }, [answered]);

  const card = cards.find(c => !done.has(c.key)) || null;
  const index = card ? cards.indexOf(card) : cards.length;

  const [picked, setPicked] = useState(null);
  const [typed, setTyped] = useState("");
  const [review, setReview] = useState(false);
  // The "?" beside Please review, and what it opens. Nobody reads a checkbox
  // label twice, so the explanation waits behind a press.
  const [noteOpen, setNoteOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  // Each question starts clean: nothing picked, Please review unticked.
  useEffect(() => { setPicked(null); setTyped(""); setReview(false); setFailed(false); setNoteOpen(false); }, [card?.key]);

  // The clock. Ticks each second only while there is one to show.
  const [now, setNow] = useState(() => fixedNow ?? Date.now());
  useEffect(() => {
    if (!limitMin || !startedAt || fixedNow) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [limitMin, startedAt, fixedNow]);
  const left = secondsLeft({ startedAt, limitMin, now });
  const outOfTime = left !== null && left <= 0;

  // Move focus to the question when it changes, so a screen reader reads it.
  const heading = useRef(null);
  useEffect(() => { if (card) heading.current?.focus({ preventScroll: true }); }, [card?.key]);

  const isTyped = card?.config?.answer === "typed";
  const value = isTyped ? typed.trim() : picked;
  const ready = value !== null && value !== "" && !sending;

  const submit = async () => {
    if (!ready || !card) return;
    setSending(true);
    setFailed(false);
    try {
      await onSubmit?.(card, value, review);
      setDone(s => new Set([...s, card.key]));
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  const shell = {
    minHeight: "100dvh", background: T.bg, color: T.text, fontFamily: T.font,
    display: "flex", flexDirection: "column", maxWidth: 560, margin: "0 auto", position: "relative",
  };

  const finished = !card || over || outOfTime;
  const top = (
    <div style={{ padding: "20px 20px 0" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 12, minHeight: TAP }}>
        <span style={{ fontFamily: T.mono, fontSize: SIZE.small, color: T.faint }}>
          {Math.min(index + 1, cards.length)} / {cards.length}
        </span>
        <span>
          {teamName ? (
            <span style={{ fontSize: SIZE.small, fontWeight: 600, padding: "4px 12px", borderRadius: 999, background: T.panel2, color: T.dim, whiteSpace: "nowrap" }}>
              {teamName}
            </span>
          ) : null}
        </span>
        <span style={{ fontFamily: T.mono, fontSize: SIZE.small, color: T.dim, textAlign: "right" }}
          aria-live="off">
          {left !== null && !finished ? timeLeft(left) : ""}
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 999, background: T.line }}>
        <div style={{ width: `${cards.length ? (100 * index) / cards.length : 0}%`, height: 4, borderRadius: 999, background: T.accent }} />
      </div>
    </div>
  );

  // Finished, closed, or out of time: the game's name, the team, a tick.
  if (finished) {
    return (
      <div className="deck-quiz" style={shell}>
        <style>{QUIZ_CSS(T)}</style>
        {top}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: "0 32px 80px", textAlign: "center" }}>
          <div style={{ width: 96, height: 96, borderRadius: 999, background: T.okTint, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Tick size={48} color={T.ok} />
          </div>
          <div style={{ fontSize: SIZE.head, fontWeight: 600 }}>{title}</div>
          {teamName ? <div style={{ fontSize: SIZE.body, color: T.dim }}>{teamName}</div> : null}
          {result ? <div style={{ fontFamily: T.mono, fontSize: SIZE.stat, lineHeight: 1 }}>{result.right} / {result.answered}</div> : null}
          {onExit ? (
            <button type="button" onClick={onExit}
              style={{ minHeight: 52, padding: "0 32px", border: "none", borderRadius: T.radius, fontFamily: T.font, fontSize: SIZE.label, fontWeight: 600, background: T.accent, color: "#ffffff", cursor: "pointer" }}>
              Done
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const c = card.config || {};
  return (
    <div className="deck-quiz" style={shell}>
      {top}
      <div style={{ flex: 1, padding: "28px 20px 132px", display: "flex", flexDirection: "column", gap: 24 }}>
        <h1 ref={heading} tabIndex={-1} style={{ margin: 0, fontSize: SIZE.head, fontWeight: 600, lineHeight: 1.2, letterSpacing: "-0.01em", outline: "none" }}>
          {c.text}
        </h1>
        {c.image ? (
          <img src={c.image} alt="" style={{ display: "block", maxWidth: "100%", borderRadius: T.radius, background: T.panel2 }} />
        ) : null}

        {isTyped ? (
          <input
            type="text" value={typed} aria-label={c.text}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
            autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={200}
            style={{
              width: "100%", boxSizing: "border-box", minHeight: 56, padding: "14px 16px", borderRadius: T.radius,
              border: "none", boxShadow: `inset 0 0 0 2px ${typed ? T.accent : T.line}`, background: T.panel,
              color: T.text, fontFamily: T.font, fontSize: SIZE.lead, outline: "none",
            }}
          />
        ) : (
          <div role="radiogroup" aria-label={c.text} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(c.options || []).map((o, i) => {
              const on = picked === i;
              return (
                <button key={i} type="button" role="radio" aria-checked={on} onClick={() => setPicked(i)}
                  className="deck-focus"
                  style={{
                    display: "flex", gap: 14, alignItems: "flex-start", textAlign: "left", width: "100%",
                    minHeight: 56, padding: "14px 16px", borderRadius: T.radius, cursor: "pointer",
                    border: "none", boxShadow: `inset 0 0 0 ${on ? 2 : 1}px ${on ? T.accent : T.line}`,
                    background: on ? T.accentTint : T.panel, color: T.text, fontFamily: T.font,
                  }}>
                  <span style={{ flex: "none", fontFamily: T.mono, fontSize: SIZE.label, color: T.accent, lineHeight: 1.4 }}>{LETTERS[i]}</span>
                  <span style={{ fontSize: SIZE.label, lineHeight: 1.4 }}>{o}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0, background: T.bg, boxShadow: `0 -1px 0 ${T.line}`,
      }}>
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "12px 20px 28px", display: "flex", flexDirection: "column", gap: 8 }}>
          {failed ? (
            <div role="alert" style={{ fontSize: SIZE.small, color: T.late }}>Not saved. Submit again.</div>
          ) : null}
          {noteOpen ? (
            <div role="dialog" aria-label="Please review"
              style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 16px", borderRadius: T.radius, background: T.panel2, color: T.text, fontSize: SIZE.small, lineHeight: 1.45 }}>
              <span style={{ flex: 1 }}>{reviewNote}</span>
              <button type="button" onClick={() => setNoteOpen(false)} aria-label="Close"
                style={{ flex: "none", width: TAP, height: TAP, margin: "-10px -10px -10px 0", border: "none", background: "none", color: T.dim, fontFamily: T.font, fontSize: SIZE.label, lineHeight: 1, cursor: "pointer" }}>
                ×
              </button>
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: TAP, fontSize: SIZE.small, color: T.dim, cursor: "pointer" }}>
                <input type="checkbox" checked={review} onChange={e => setReview(e.target.checked)}
                  style={{ position: "absolute", opacity: 0, width: 1, height: 1 }} />
                <span aria-hidden="true" style={{
                  width: 24, height: 24, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: review ? T.accent : T.panel, boxShadow: review ? "none" : `inset 0 0 0 2px ${T.ghost}`,
                }}>
                  {review ? <Tick size={15} color="#ffffff" /> : null}
                </span>
                Please review
              </label>
              <button type="button" onClick={() => setNoteOpen(o => !o)}
                aria-label="What Please review does" aria-expanded={noteOpen}
                style={{ flex: "none", width: TAP, height: TAP, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", cursor: "pointer" }}>
                <span aria-hidden="true" style={{
                  width: 22, height: 22, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontFamily: T.mono, fontSize: SIZE.micro, fontWeight: 600,
                  background: noteOpen ? T.accent : T.panel2, color: noteOpen ? "#ffffff" : T.dim,
                }}>
                  ?
                </span>
              </button>
            </div>
            <button type="button" onClick={submit} disabled={!ready}
              style={{
                minHeight: 52, padding: "0 32px", border: "none", borderRadius: T.radius,
                fontFamily: T.font, fontSize: SIZE.label, fontWeight: 600, cursor: ready ? "pointer" : "default",
                background: ready ? T.accent : T.line, color: ready ? "#ffffff" : T.dim,
              }}>
              Submit
            </button>
          </div>
        </div>
      </div>
      <style>{QUIZ_CSS(T)}</style>
    </div>
  );
}

/**
 * A team phone's first screen, when the game lets phones form teams: the team
 * types its name and ticks who is on it. The phone's own viewer is always on.
 */
export function TeamStart({ title, roster = [], viewerId, onStart, theme }) {
  const T = useMemo(() => ({ ...DEFAULT_THEME, ...theme }), [theme]);
  const [name, setName] = useState("");
  const [members, setMembers] = useState(() => new Set(viewerId ? [viewerId] : []));
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = name.trim() && members.size && !sending;

  const start = async () => {
    if (!ready) return;
    setSending(true);
    setFailed(false);
    try { await onStart?.(name.trim(), [...members]); } catch { setFailed(true); } finally { setSending(false); }
  };

  return (
    <div className="deck-quiz" style={{ minHeight: "100dvh", background: T.bg, color: T.text, fontFamily: T.font, maxWidth: 560, margin: "0 auto", padding: "28px 20px 132px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 24 }}>
      <style>{QUIZ_CSS(T)}</style>
      <h1 style={{ margin: 0, fontSize: SIZE.head, fontWeight: 600 }}>{title}</h1>
      <label style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: SIZE.small, color: T.dim }}>
        Team name
        <input type="text" value={name} onChange={e => setName(e.target.value)} maxLength={40}
          style={{ minHeight: 56, padding: "14px 16px", borderRadius: T.radius, border: "none", boxShadow: `inset 0 0 0 2px ${name ? T.accent : T.line}`, background: T.panel, color: T.text, fontFamily: T.font, fontSize: SIZE.lead, outline: "none" }} />
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, background: T.panel, borderRadius: T.radiusLarge, boxShadow: `0 0 0 1px ${T.line}`, overflow: "hidden" }}>
        {roster.map(s => {
          const on = members.has(s.id);
          const mine = s.id === viewerId;
          return (
            <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: TAP + 8, padding: "0 16px", fontSize: SIZE.body, cursor: mine ? "default" : "pointer", boxShadow: `0 1px 0 ${T.line}` }}>
              <input type="checkbox" checked={on} disabled={mine}
                onChange={() => setMembers(m => { const n = new Set(m); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}
                style={{ width: 22, height: 22, accentColor: T.accent }} />
              {s.name}
            </label>
          );
        })}
      </div>
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: T.bg, boxShadow: `0 -1px 0 ${T.line}` }}>
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "12px 20px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span role={failed ? "alert" : undefined} style={{ fontSize: SIZE.small, color: T.late }}>{failed ? "Not saved. Start again." : ""}</span>
          <button type="button" onClick={start} disabled={!ready}
            style={{ minHeight: 52, padding: "0 32px", border: "none", borderRadius: T.radius, fontFamily: T.font, fontSize: SIZE.label, fontWeight: 600, background: ready ? T.accent : T.line, color: ready ? "#ffffff" : T.dim, cursor: ready ? "pointer" : "default" }}>
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
