// The host's side of a game: the game panel, drawn from the Game Panel canvas.
//
// What Andrew asked for, and where each one lives here:
//   Answers as they come in, each question's spread and percent right, and a
//   ranking by percent right of questions answered so far      → AllQuestions
//   Click a question: the options, how many picked each, and how many of those
//   asked for review; accept a different answer, with what it changes first
//                                                              → OneQuestion
//   Typed answers grouped: right, close to right, the rest     → TypedAnswers
//   Close asks first                                           → CloseConfirm
//   After: release scores and answers, let a student take it later, put the
//   spread and all questions on the room screen                → AfterClose
//
// Names are shown here, never on the wall. The component draws from plain
// rows and reports actions up; GamePanelLive wires it to the database.

import { useMemo, useState, useEffect, useCallback } from "react";
import { DEFAULT_THEME, SIZE } from "../tokens.js";
import { scoreGame, previewAccept, groupTyped, spreadBuckets, timeLeft } from "./score.js";
import { loadHostGame, watchGame, acceptAnswer, openGame, closeGame, release, grantExtraTime } from "./host.js";
import { OpenConfirm } from "./GameSetup.jsx";

const LETTERS = "ABCDEFGHIJ";
const HIT = 34;   // an instructor surface: a trackpad under your hands

const Tick = ({ size = 15, color }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{ flex: "none" }}>
    <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * @param {string}   context   Above the title, e.g. the class code.
 * @param {object}   game      { deck, cards, keys, accepts, responses, progress, teams, extra }.
 * @param {object[]} roster    [{ id, name }]: who could play. Ids match viewer ids.
 * @param {number}   now       Milliseconds, for the clock.
 * @param {object}   on        { accept(cardId, value), close(), release(kind), extraTime(viewerId, minutes), screen(view) }
 *                             Each may return a promise.
 */
export default function GamePanel({ context, game, roster = [], now = Date.now(), on = {}, theme }) {
  const T = useMemo(() => ({ ...DEFAULT_THEME, ...theme }), [theme]);
  const [openCard, setOpenCard] = useState(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { deck, cards = [], keys = {}, accepts = [], responses = [], progress = [], teams = [], extra = [] } = game;
  const score = useMemo(() => scoreGame({ cards, keys, accepts, responses }), [cards, keys, accepts, responses]);

  const teamGame = deck.teams && deck.teams !== "none";
  const nameOf = (id) => teams.find(t => t.id === id)?.name || roster.find(r => r.id === id)?.name || id;
  const submitted = progress.filter(p => p.completed_at).length;
  const answering = new Set(deck.closed_at ? [] : progress.filter(p => !p.completed_at).map(p => p.viewer_id));
  const started = new Set(progress.map(p => p.viewer_id));
  const notStarted = teamGame ? [] : roster.filter(r => !started.has(r.id));
  const closed = !!deck.closed_at;

  const kinds = new Set(cards.map(c => c.config?.answer === "typed" ? "typed" : "choice"));
  const tags = [teamGame ? "Teams" : "Individual", kinds.size > 1 ? "Mixed" : kinds.has("typed") ? "Free-form" : "Multiple choice"];

  const ends = deck.closes_at ? Date.parse(deck.closes_at)
    : deck.time_limit_min && deck.opened_at ? Date.parse(deck.opened_at) + deck.time_limit_min * 60000 : null;

  const card = cards.find(c => c.id === openCard) || null;

  const s = styles(T);
  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: T.font, fontSize: SIZE.small }}>
      <style>{`.gp-row{cursor:pointer}.gp-row:hover{background:${T.panel2}}.gp button:focus-visible,.gp-row:focus-visible{outline:2px solid ${T.accent};outline-offset:2px}.gp *{box-sizing:border-box}`}</style>
      <div className="gp">
        {/* Header: the game, and the numbers that matter while it runs. */}
        <div style={{ display: "flex", alignItems: "center", gap: 24, padding: "20px 32px", background: T.panel, boxShadow: `0 1px 0 ${T.line}`, position: "relative" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            {context ? <span style={{ fontSize: SIZE.micro, color: T.faint }}>{context}</span> : null}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: SIZE.head, fontWeight: 600, letterSpacing: "-0.01em" }}>{deck.title}</span>
              {tags.map(t => <span key={t} style={s.tag}>{t}</span>)}
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 32 }}>
            {!deck.opened_at ? (
              <>
                {on.edit ? <button type="button" style={s.ghost} onClick={() => on.edit()}>Edit</button> : null}
                <button type="button" style={s.solid} onClick={() => setConfirmOpen(true)}>Open</button>
              </>
            ) : null}
            {!closed && deck.opened_at && on.screen ? <button type="button" style={s.ghost} onClick={() => on.screen({ view: "during" })}>Put on screen</button> : null}
            {!closed && ends ? <Stat T={T} label="Time left" value={timeLeft((ends - now) / 1000)} /> : null}
            {deck.opened_at ? <Stat T={T} label="Submitted" value={teamGame ? `${submitted} / ${teams.length}` : submitted} /> : null}
            {!closed && deck.opened_at ? <Stat T={T} label="Answering" value={answering.size} color={T.ok} /> : null}
            {!closed && deck.opened_at && !teamGame ? <Stat T={T} label="Not started" value={notStarted.length} /> : null}
            {closed ? <Stat T={T} label="Class average" value={`${score.average}%`} /> : null}
            {!closed && deck.opened_at ? <button type="button" style={s.ghost} onClick={() => setConfirmClose(true)}>Close</button> : null}
          </div>
          {confirmOpen ? <OpenConfirm T={T} title={deck.title} questions={cards.length} onCancel={() => setConfirmOpen(false)} onOpen={async () => { setConfirmOpen(false); await on.open?.(); }} /> : null}
          {confirmClose ? (
            <CloseConfirm T={T} title={deck.title} submitted={submitted} answering={answering.size} notStarted={notStarted.length} teamGame={teamGame}
              onCancel={() => setConfirmClose(false)}
              onClose={async () => { setConfirmClose(false); await on.close?.(); }} />
          ) : null}
        </div>

        {closed && !card ? (
          <AfterClose T={T} deck={deck} score={score} notStarted={notStarted} extra={extra} nameOf={nameOf} on={on} />
        ) : null}

        {card ? (
          <OneQuestion T={T} cards={cards} card={card} score={score} game={game} nameOf={nameOf} closed={closed}
            onPick={setOpenCard} onBack={() => setOpenCard(null)} on={on} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 400px", gap: 24, padding: "24px 32px" }}>
            <AllQuestions T={T} score={score} onOpen={setOpenCard} />
            <Ranking T={T} ranking={score.ranking} average={score.average} nameOf={nameOf} answering={answering} />
          </div>
        )}
      </div>
    </div>
  );
}

function styles(T) {
  const btn = { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: HIT, padding: "0 14px", borderRadius: T.radius, fontFamily: T.font, fontSize: SIZE.small, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", border: "none" };
  return {
    tag: { fontSize: SIZE.micro, fontWeight: 500, padding: "3px 10px", borderRadius: 999, background: T.panel2, color: T.dim },
    ghost: { ...btn, background: T.panel, color: T.accent, boxShadow: `inset 0 0 0 1px ${T.line}` },
    solid: { ...btn, background: T.accent, color: "#ffffff" },
    quiet: { ...btn, background: "transparent", color: T.accent },
    card: { background: T.panel, borderRadius: T.radiusLarge, boxShadow: `0 0 0 1px ${T.line}` },
    mono: { fontFamily: T.mono },
  };
}

const Stat = ({ T, label, value, color }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
    <span style={{ fontSize: SIZE.micro, color: T.faint }}>{label}</span>
    <span style={{ fontFamily: T.mono, fontSize: SIZE.lead, color: color || T.text }}>{value}</span>
  </div>
);

const ReviewCount = ({ T, n }) => n
  ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: T.mono, fontSize: SIZE.small, color: T.warn }}><Tick color={T.warn} />{n}</span>
  : <span style={{ fontFamily: T.mono, fontSize: SIZE.small, color: T.faint }}>·</span>;

function SpreadBar({ T, q, width }) {
  if (q.typed) {
    return (
      <div style={{ width, height: 12, borderRadius: 999, background: T.panel2, overflow: "hidden" }}>
        <div style={{ width: `${q.pct}%`, height: 12, background: T.ok }} />
      </div>
    );
  }
  const n = q.counts.reduce((a, b) => a + b, 0) || 1;
  const shades = [T.ghost, T.line, "#d8d1c9", "#b9b0a6", T.ghost, T.line];
  return (
    <div style={{ display: "flex", width, height: 12, borderRadius: 999, overflow: "hidden", background: T.panel2 }}>
      {q.counts.map((c, i) => c ? (
        <div key={i} style={{ width: `${(100 * c) / n}%`, background: q.correct?.includes(i) ? T.ok : shades[i], boxShadow: `inset -2px 0 0 ${T.panel}` }} />
      ) : null)}
    </div>
  );
}

function AllQuestions({ T, score, onOpen }) {
  const cols = "32px minmax(0, 1fr) 180px 56px 44px";
  return (
    <div style={{ background: T.panel, borderRadius: T.radiusLarge, boxShadow: `0 0 0 1px ${T.line}`, overflow: "hidden", alignSelf: "start" }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 16, padding: "14px 20px", fontSize: SIZE.micro, color: T.faint, boxShadow: `0 1px 0 ${T.line}`, alignItems: "end" }}>
        <span /><span style={{ fontSize: SIZE.body, fontWeight: 600, color: T.text }}>All questions</span>
        <span>Answers</span><span style={{ textAlign: "right" }}>Right</span>
        <span style={{ display: "flex", justifyContent: "flex-end" }} title="Please review"><Tick color={T.faint} /></span>
      </div>
      {score.questions.map((q, i) => (
        <div key={q.cardId} className="gp-row" role="button" tabIndex={0}
          onClick={() => onOpen(q.cardId)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(q.cardId); } }}
          style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 16, minHeight: 56, padding: "0 20px", boxShadow: `0 1px 0 ${T.line}` }}>
          <span style={{ fontFamily: T.mono, fontSize: SIZE.small, color: T.faint }}>{i + 1}</span>
          <span style={{ fontSize: SIZE.small, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{q.text}</span>
          <SpreadBar T={T} q={q} width={180} />
          <span style={{ fontFamily: T.mono, fontSize: SIZE.body, textAlign: "right", color: q.answered ? (q.tough ? T.warn : T.text) : T.faint }}>{q.answered ? `${q.pct}%` : "·"}</span>
          <span style={{ textAlign: "right" }}><ReviewCount T={T} n={q.reviews} /></span>
        </div>
      ))}
    </div>
  );
}

function Ranking({ T, ranking, average, nameOf, answering }) {
  return (
    <div style={{ background: T.panel, borderRadius: T.radiusLarge, boxShadow: `0 0 0 1px ${T.line}`, padding: "14px 0 10px", alignSelf: "start" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 20px 8px" }}>
        <span style={{ fontSize: SIZE.body, fontWeight: 600 }}>Scores</span>
        <span style={{ fontSize: SIZE.micro, color: T.faint }}>Right / answered</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) 64px 48px", alignItems: "center", gap: 12, minHeight: 36, padding: "0 20px", margin: "0 0 6px", background: T.panel2 }}>
        <span />
        <span style={{ fontSize: SIZE.small, fontWeight: 600 }}>Average</span>
        <span />
        <span style={{ fontFamily: T.mono, fontSize: SIZE.small, fontWeight: 600, textAlign: "right" }}>{ranking.length ? `${average}%` : "·"}</span>
      </div>
      {ranking.map((v, i) => (
        <div key={v.viewerId} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) 64px 48px", alignItems: "center", gap: 12, minHeight: 28, padding: "0 20px" }}>
          <span style={{ fontFamily: T.mono, fontSize: SIZE.micro, color: T.faint }}>{i + 1}</span>
          <span style={{ fontSize: SIZE.small, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf(v.viewerId)}</span>
            {answering.has(v.viewerId) ? <span title="Answering" style={{ flex: "none", width: 8, height: 8, borderRadius: 999, background: T.ok }} /> : null}
          </span>
          <span style={{ fontFamily: T.mono, fontSize: SIZE.micro, color: T.faint, textAlign: "right" }}>{v.right}/{v.answered}</span>
          <span style={{ fontFamily: T.mono, fontSize: SIZE.small, textAlign: "right" }}>{v.pct}%</span>
        </div>
      ))}
    </div>
  );
}

function CloseConfirm({ T, title, submitted, answering, notStarted, teamGame, onCancel, onClose }) {
  const s = styles(T);
  return (
    <div role="dialog" aria-label={`Close ${title}`} style={{ position: "absolute", top: 76, right: 32, width: 320, zIndex: 5, ...s.card, boxShadow: `0 0 0 1px ${T.line}, 0 16px 40px -16px rgba(28,25,23,.3)`, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: SIZE.body, fontWeight: 600 }}>Close {title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: 10, fontSize: SIZE.small }}>
        <span style={{ color: T.dim }}>Submitted</span><span style={s.mono}>{submitted}</span>
        <span style={{ color: T.dim }}>Answering</span><span style={{ ...s.mono, color: T.ok }}>{answering}</span>
        {!teamGame ? <><span style={{ color: T.dim }}>Not started</span><span style={s.mono}>{notStarted}</span></> : null}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" style={s.quiet} onClick={onCancel}>Cancel</button>
        <button type="button" style={s.solid} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function OneQuestion({ T, cards, card, score, game, nameOf, closed, onPick, onBack, on }) {
  const s = styles(T);
  const [pending, setPending] = useState(null);   // { value, label }
  const qi = cards.findIndex(c => c.id === card.id);
  const q = score.questions.find(x => x.cardId === card.id);
  const correct = game.keys[card.id] || [];
  const accepted = game.accepts.filter(a => a.card_id === card.id).map(a => a.value);
  const preview = pending ? previewAccept(game, card.id, pending.value) : null;

  const accept = async () => {
    const v = pending.value;
    setPending(null);
    await on.accept?.(card.id, v);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr) 340px", gap: 24, padding: "24px 32px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <button type="button" onClick={onBack} style={{ ...s.quiet, justifyContent: "flex-start", padding: "0 12px", color: T.accent }}>All questions</button>
        {score.questions.map((x, i) => (
          <div key={x.cardId} className="gp-row" role="button" tabIndex={0}
            onClick={() => { setPending(null); onPick(x.cardId); }}
            onKeyDown={e => { if (e.key === "Enter") { setPending(null); onPick(x.cardId); } }}
            style={{ display: "flex", alignItems: "center", gap: 10, minHeight: HIT, padding: "0 12px", borderRadius: 8, ...(x.cardId === card.id ? { background: T.panel, boxShadow: `0 0 0 1px ${T.line}` } : {}) }}>
            <span style={{ flex: "none", width: 18, fontFamily: T.mono, fontSize: SIZE.micro, color: T.faint }}>{i + 1}</span>
            <span style={{ fontFamily: T.mono, fontSize: SIZE.small, color: x.tough ? T.warn : x.answered ? T.text : T.faint }}>{x.answered ? `${x.pct}%` : "·"}</span>
            <span style={{ marginLeft: "auto" }}><ReviewCount T={T} n={x.reviews} /></span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <span style={{ fontFamily: T.mono, fontSize: SIZE.lead, color: T.faint, lineHeight: 1.3 }}>{qi + 1}</span>
          <span style={{ fontSize: SIZE.head, fontWeight: 600, lineHeight: 1.2, letterSpacing: "-0.01em" }}>{card.config?.text}</span>
        </div>
        {card.config?.image ? <img src={card.config.image} alt="" style={{ maxWidth: 360, borderRadius: T.radius }} /> : null}
        <div style={{ display: "flex", gap: 32, alignItems: "flex-end" }}>
          <Stat T={T} label="Right" value={q.answered ? `${q.pct}%` : "·"} color={q.tough ? T.warn : undefined} />
          <Stat T={T} label="Answered" value={q.answered} />
          <Stat T={T} label="Please review" value={q.reviews} color={q.reviews ? T.warn : undefined} />
          {closed ? <span style={{ marginLeft: "auto" }}><button type="button" style={s.ghost} onClick={() => on.screen?.({ view: "question", cardId: card.id })}>Put on screen</button></span> : null}
        </div>

        {q.typed ? (
          <TypedAnswers T={T} q={q} correct={correct} accepted={accepted} nameOf={nameOf} game={game} card={card}
            onAccept={(value) => setPending({ value, label: value })} />
        ) : (
          <ChoiceAnswers T={T} q={q} card={card} correct={correct} accepted={accepted}
            onAccept={(i) => setPending({ value: i, label: LETTERS[i] })} />
        )}
      </div>

      <div>
        {pending && preview ? (
          <div style={{ ...s.card, boxShadow: `0 0 0 1px ${T.line}, 0 12px 32px -16px rgba(28,25,23,.25)`, padding: 20, display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 24 }}>
            <div style={{ fontSize: SIZE.body, fontWeight: 600 }}>Accept {pending.label}</div>
            {!q.typed ? <div style={{ fontSize: SIZE.small, color: T.dim, lineHeight: 1.4 }}>{card.config?.options?.[pending.value]}</div> : null}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: 12, fontSize: SIZE.small }}>
              <span style={{ color: T.dim }}>Question {qi + 1} right</span><span style={s.mono}>{preview.questionBefore}% → {preview.questionAfter}%</span>
              <span style={{ color: T.dim }}>Class average</span><span style={s.mono}>{preview.averageBefore}% → {preview.averageAfter}%</span>
              <span style={{ color: T.dim }}>Scores that go up</span><span style={s.mono}>{preview.scoresUp}</span>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" style={s.quiet} onClick={() => setPending(null)}>Cancel</button>
              <button type="button" style={s.solid} onClick={accept}>Accept</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChoiceAnswers({ T, q, card, correct, accepted, onAccept }) {
  const s = styles(T);
  // The answer's words get the width; its bar sits under them.
  const cols = "28px minmax(0, 1fr) 48px 44px 104px";
  const n = q.counts.reduce((a, b) => a + b, 0) || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 16, padding: "0 20px", fontSize: SIZE.micro, color: T.faint }}>
        <span /><span /><span style={{ textAlign: "right" }}>Picked</span>
        <span style={{ display: "flex", justifyContent: "flex-end" }} title="Please review"><Tick color={T.faint} /></span><span />
      </div>
      {(card.config?.options || []).map((o, i) => {
        const key = correct.includes(i);
        const right = key || accepted.includes(i);
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 16, minHeight: 64, padding: "10px 20px", borderRadius: T.radius, background: T.panel, boxShadow: `inset 0 0 0 1px ${right ? T.ok : T.line}` }}>
            <span style={{ fontFamily: T.mono, fontSize: SIZE.body, color: right ? T.ok : T.faint }}>{LETTERS[i]}</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: SIZE.body, lineHeight: 1.35 }}>{o}</span>
              <span style={{ display: "block", height: 10, borderRadius: 999, background: T.panel2 }}>
                <span style={{ display: "block", width: `${(100 * q.counts[i]) / n}%`, height: 10, borderRadius: 999, background: right ? T.ok : T.ghost }} />
              </span>
            </span>
            <span style={{ fontFamily: T.mono, fontSize: SIZE.body, textAlign: "right" }}>{q.counts[i]}</span>
            <span style={{ textAlign: "right" }}><ReviewCount T={T} n={q.reviewBy[i]} /></span>
            <span style={{ textAlign: "right" }}>
              {right
                ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: SIZE.small, fontWeight: 600, color: T.ok }}><Tick size={16} color={T.ok} />Right</span>
                : <button type="button" style={s.ghost} onClick={() => onAccept(i)}>Accept</button>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TypedAnswers({ T, q, correct, accepted, nameOf, game, card, onAccept }) {
  const s = styles(T);
  const groups = groupTyped(q.answers, correct, accepted);
  const answeredBy = new Set(q.answers.map(a => a.viewerId));
  const silent = (game.teams.length ? game.teams.map(t => t.id) : []).filter(id => !answeredBy.has(id));
  const row = (a, kind) => (
    <div key={a.viewerId} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 220px 104px", alignItems: "center", gap: 16, minHeight: 52, padding: "8px 20px", boxShadow: `0 1px 0 ${T.line}` }}>
      <span style={{ fontSize: SIZE.body }}>{String(a.value)}</span>
      <span style={{ fontSize: SIZE.small, color: T.dim, display: "flex", alignItems: "center", gap: 6 }}>{nameOf(a.viewerId)}{a.review ? <Tick color={T.warn} /> : null}</span>
      <span style={{ textAlign: "right" }}>
        {kind === "right"
          ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: SIZE.small, fontWeight: 600, color: T.ok }}><Tick size={16} color={T.ok} />Right</span>
          : <button type="button" style={kind === "close" ? s.solid : s.ghost} onClick={() => onAccept(a.value)}>Accept</button>}
      </span>
    </div>
  );
  const group = (label, color, bg, rows, key) => rows.length ? (
    <div key={key} style={{ ...s.card, overflow: "hidden" }}>
      <div style={{ padding: "12px 20px", fontSize: SIZE.micro, fontWeight: 600, color, background: bg }}>{label}</div>
      {rows}
    </div>
  ) : null;
  const rightLabel = [...correct, ...accepted].map(String).join(", ");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {group(rightLabel || "Right", T.ok, T.okTint, groups.right.map(a => row(a, "right")), "right")}
      {groups.close.map(g => group(`Close to ${g.to}`, T.warn, T.warnTint, g.answers.map(a => row(a, "close")), `close-${g.to}`))}
      {group("Other answers", T.dim, T.panel2, groups.other.map(a => row(a, "other")), "other")}
      {silent.length ? <div style={{ fontSize: SIZE.small, color: T.faint, padding: "0 4px" }}>{silent.map(nameOf).join(", ")}</div> : null}
    </div>
  );
}

function AfterClose({ T, deck, score, notStarted, extra, nameOf, on }) {
  const s = styles(T);
  const [minutes, setMinutes] = useState({});
  const buckets = spreadBuckets(score.ranking.map(v => v.pct));
  const max = Math.max(1, ...buckets.map(b => b.count));
  const late = [...new Set([...notStarted.map(r => r.id), ...extra.map(x => x.viewer_id)])];
  const released = (col) => deck[col] ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: SIZE.small, fontWeight: 600, color: T.ok }}><Tick size={16} color={T.ok} />Released</span> : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px 360px minmax(0, 1fr)", gap: 24, padding: "24px 32px 0" }}>
      <div style={{ ...s.card, overflow: "hidden", alignSelf: "start" }}>
        <div style={{ padding: "14px 20px", fontSize: SIZE.body, fontWeight: 600, boxShadow: `0 1px 0 ${T.line}` }}>Release</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 52, padding: "0 20px", boxShadow: `0 1px 0 ${T.line}` }}>
          <span>Scores</span>{released("scores_released_at") || <button type="button" style={s.solid} onClick={() => on.release?.("scores")}>Release scores</button>}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 52, padding: "0 20px" }}>
          <span>Answers</span>{released("answers_released_at") || <button type="button" style={s.ghost} onClick={() => on.release?.("answers")}>Release answers</button>}
        </div>
      </div>

      <div style={{ ...s.card, overflow: "hidden", alignSelf: "start" }}>
        <div style={{ padding: "14px 20px", fontSize: SIZE.body, fontWeight: 600, boxShadow: `0 1px 0 ${T.line}` }}>Take it later</div>
        {late.length ? late.map(id => {
          const given = extra.find(x => x.viewer_id === id);
          return (
            <div key={id} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 52, padding: "0 20px", boxShadow: `0 1px 0 ${T.line}` }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{nameOf(id)}</span>
              {given ? <span style={{ fontFamily: T.mono, color: T.ok }}>{given.minutes} min</span> : (
                <>
                  <input type="number" min="1" max="240" aria-label={`Minutes for ${nameOf(id)}`} value={minutes[id] ?? ""}
                    onChange={e => setMinutes(m => ({ ...m, [id]: e.target.value }))}
                    style={{ width: 72, minHeight: HIT, padding: "0 10px", borderRadius: 8, border: "none", boxShadow: `inset 0 0 0 1px ${T.line}`, fontFamily: T.mono, fontSize: 16, color: T.text, background: T.panel }} />
                  <span style={{ color: T.faint }}>min</span>
                  <button type="button" style={s.ghost} disabled={!(Number(minutes[id]) > 0)}
                    onClick={() => on.extraTime?.(id, Number(minutes[id]))}>Let in</button>
                </>
              )}
            </div>
          );
        }) : <div style={{ minHeight: 52 }} />}
      </div>

      <div style={{ ...s.card, padding: "14px 20px 16px", alignSelf: "start" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 12 }}>
          <span style={{ fontSize: SIZE.body, fontWeight: 600 }}>Spread of scores</span>
          <button type="button" style={s.ghost} onClick={() => on.screen?.({ view: "spread" })}>Put on screen</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr)", columnGap: 8 }}>
          <span style={{ gridColumn: "1 / 3", fontSize: SIZE.micro, color: T.faint, paddingBottom: 18 }}>Students</span>
          <div style={{ position: "relative", height: 120 }}>
            <span style={{ position: "absolute", right: 0, top: -2, fontFamily: T.mono, fontSize: SIZE.micro, color: T.faint }}>{max}</span>
            <span style={{ position: "absolute", right: 0, bottom: -2, fontFamily: T.mono, fontSize: SIZE.micro, color: T.faint }}>0</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 120, boxShadow: `0 2px 0 ${T.faint}` }}>
            {buckets.map(b => (
              <div key={b.from} style={{ flex: 1, position: "relative", height: "100%" }}>
                <span style={{ position: "absolute", left: 0, right: 0, bottom: `calc(${(100 * b.count) / max}% + 4px)`, textAlign: "center", fontFamily: T.mono, fontSize: SIZE.micro }}>{b.count}</span>
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${(100 * b.count) / max}%`, borderRadius: "4px 4px 0 0", background: T.ghost }} />
              </div>
            ))}
          </div>
          <span />
          <div style={{ display: "flex", gap: 8, paddingTop: 6 }}>
            {buckets.map(b => <span key={b.from} style={{ flex: 1, textAlign: "center", fontFamily: T.mono, fontSize: SIZE.micro, color: T.faint }}>{b.from}%</span>)}
          </div>
          <span />
          <span style={{ textAlign: "center", fontSize: SIZE.micro, color: T.faint, paddingTop: 4 }}>Score</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 16, marginTop: 14, boxShadow: `0 -1px 0 ${T.line}` }}>
          <span style={{ fontSize: SIZE.body, fontWeight: 600 }}>All questions</span>
          <button type="button" style={s.ghost} onClick={() => on.screen?.({ view: "questions" })}>Put on screen</button>
        </div>
        {deck.teams && deck.teams !== "none" ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 16, marginTop: 14, boxShadow: `0 -1px 0 ${T.line}` }}>
            <span style={{ fontSize: SIZE.body, fontWeight: 600 }}>Teams</span>
            <button type="button" style={s.ghost} onClick={() => on.screen?.({ view: "teams" })}>Put on screen</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The panel wired to the database: loads the game, redraws as answers arrive
 * (realtime, or polling on a client without it), and writes each action.
 */
export function GamePanelLive({ supabase, deckId, context, roster, theme, onScreen, onError, onBack, onEdit, onChange }) {
  const [game, setGame] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try { const g = await loadHostGame(supabase, { deckId }); if (g) { setGame(g); onChange?.(g); } }
    catch (e) { onError?.(e); }
  }, [supabase, deckId, onError, onChange]);

  useEffect(() => {
    if (!supabase) return undefined;
    load();
    const stop = watchGame(supabase, { deckId, onChange: load });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { stop(); clearInterval(tick); };
  }, [supabase, deckId, load]);

  const act = (fn) => async (...args) => { try { await fn(...args); await load(); } catch (e) { onError?.(e); } };
  const on = {
    accept: act((cardId, value) => acceptAnswer(supabase, { deckId, cardId, value })),
    close: act(() => closeGame(supabase, { deckId })),
    release: act((kind) => release(supabase, { deckId, kind })),
    extraTime: act((viewerId, minutes) => grantExtraTime(supabase, { deckId, viewerId, minutes })),
    open: act(() => openGame(supabase, { deckId })),
    screen: onScreen ? (view) => onScreen(view, game) : undefined,
    back: onBack,
    edit: onEdit && !(game?.responses?.length) ? onEdit : undefined,
  };

  const T = { ...DEFAULT_THEME, ...theme };
  if (!game) return <div style={{ minHeight: "100vh", background: T.bg }} />;
  return <GamePanel context={context} game={game} roster={roster} now={now} on={on} theme={theme} />;
}
