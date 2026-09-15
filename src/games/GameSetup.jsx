// Adding and editing a game, in the game panel: its questions and its
// settings, before it opens.
//
// What Andrew decided, and where it lives here:
//   Multiple choice or free-form, per question; a game may mix them.
//   Free-form keeps the answers to accept, typed ahead.
//   An image can sit in a question.
//   Individual or teams, per game; teams set here or picked by the phone.
//   A timer for the whole game, only when time is on; a closing time.
//   Whether the scores go into grades, per game.
//
// Editing stops once the first answer lands (the panel hides Edit then);
// accepting answers stays open for as long as the game exists.

import { useMemo, useState, useEffect } from "react";
import { DEFAULT_THEME, SIZE } from "../tokens.js";
import { loadHostGame, saveGame, saveTeams, openGame } from "./host.js";

const LETTERS = "ABCDEFGHIJ";
const HIT = 34;

const blank = (answer = "choice") => ({ key: Math.random().toString(36).slice(2), text: "", image: "", answer, options: ["", "", "", ""], correct: answer === "choice" ? [] : [], accepted: "" });

/** Rows from the database into the shape the form edits. */
export function formFrom(game) {
  const questions = (game.cards || []).map(c => {
    const correct = game.keys?.[c.id] || [];
    const typed = c.config?.answer === "typed";
    return {
      id: c.id, key: c.id, text: c.config?.text || "", image: c.config?.image || "", answer: typed ? "typed" : "choice",
      options: typed ? ["", "", "", ""] : [...(c.config?.options || [])],
      correct: typed ? [] : correct, accepted: typed ? correct.join(", ") : "",
    };
  });
  const d = game.deck || {};
  return {
    title: d.title || "",
    teams: d.teams || "none",
    timeOn: !!d.time_limit_min, minutes: d.time_limit_min || 20,
    closesAt: d.closes_at ? toLocalInput(d.closes_at) : "",
    gradebook: !!d.gradebook,
    questions: questions.length ? questions : [blank()],
    teamRows: (game.teams || []).map(t => ({ id: t.id, name: t.name, members: t.members || [] })),
  };
}

const toLocalInput = (iso) => {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** What stops a save: the words of what is missing are the panel's, the checks are here. */
export function problems(form) {
  const out = [];
  if (!form.title.trim()) out.push({ at: "title" });
  form.questions.forEach((q, i) => {
    if (!q.text.trim()) out.push({ at: i, what: "text" });
    if (q.answer === "choice") {
      if (q.options.filter(o => o.trim()).length < 2) out.push({ at: i, what: "options" });
      if (!q.correct.length || !q.options[q.correct[0]]?.trim()) out.push({ at: i, what: "correct" });
    }
  });
  return out;
}

export function toSave(form) {
  const questions = form.questions.map(q => {
    if (q.answer === "typed") {
      return { id: q.id, text: q.text, image: q.image, answer: "typed", correct: q.accepted.split(",").map(s => s.trim()).filter(Boolean) };
    }
    // Empty options drop out, and the right answer's index follows its option.
    const kept = q.options.map((o, i) => [o, i]).filter(([o]) => o.trim());
    const right = kept.findIndex(([, i]) => i === q.correct[0]);
    return { id: q.id, text: q.text, image: q.image, answer: "choice", options: kept.map(([o]) => o), correct: right >= 0 ? [right] : [] };
  });
  const settings = {
    title: form.title.trim(),
    teams: form.teams,
    time_limit_min: form.timeOn ? Math.max(1, Number(form.minutes) || 1) : null,
    closes_at: form.closesAt ? new Date(form.closesAt).toISOString() : null,
    gradebook: !!form.gradebook,
  };
  return { settings, questions };
}

export default function GameSetup({ supabase, deckId, roster = [], context, theme, onDone, onBack, onSaved, onError }) {
  const T = useMemo(() => ({ ...DEFAULT_THEME, ...theme }), [theme]);
  const [game, setGame] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    loadHostGame(supabase, { deckId }).then(g => { if (alive && g) { setGame(g); setForm(formFrom(g)); } }).catch(e => onError?.(e));
    return () => { alive = false; };
  }, [supabase, deckId]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!form) return <div style={{ minHeight: "100vh", background: T.bg }} />;

  const set = (patch) => { setSaved(false); setForm(f => ({ ...f, ...patch })); };
  const setQ = (i, patch) => set({ questions: form.questions.map((q, n) => (n === i ? { ...q, ...patch } : q)) });
  const bad = problems(form);
  const badAt = (at, what) => tried && bad.some(p => p.at === at && (!what || p.what === what));

  const save = async (andOpen) => {
    setTried(true);
    if (bad.length) return false;
    setSaving(true);
    try {
      const { settings, questions } = toSave(form);
      await saveGame(supabase, { deckId, settings, questions, existingIds: game.cards.map(c => c.id) });
      if (form.teams === "panel") await saveTeams(supabase, { deckId, teams: form.teamRows, existing: game.teams });
      if (andOpen) await openGame(supabase, { deckId });
      const fresh = await loadHostGame(supabase, { deckId });
      setGame(fresh);
      setForm(formFrom(fresh));
      setTried(false);
      setSaved(true);
      onSaved?.();
      if (andOpen) onDone?.();
      return true;
    } catch (e) {
      onError?.(e);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const s = setupStyles(T);
  const move = (i, by) => {
    const j = i + by;
    if (j < 0 || j >= form.questions.length) return;
    const qs = [...form.questions];
    [qs[i], qs[j]] = [qs[j], qs[i]];
    set({ questions: qs });
  };

  return (
    <div className="gs" style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: T.font, fontSize: SIZE.small }}>
      <style>{`.gs *{box-sizing:border-box}.gs button:focus-visible,.gs input:focus-visible,.gs textarea:focus-visible{outline:2px solid ${T.accent};outline-offset:2px}`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "20px 32px", background: T.panel, boxShadow: `0 1px 0 ${T.line}`, position: "relative" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
          {context ? <span style={{ fontSize: SIZE.micro, color: T.faint }}>{context}</span> : null}
          <input value={form.title} onChange={e => set({ title: e.target.value })} aria-label="Title"
            style={{ ...s.input, fontSize: SIZE.head, fontWeight: 600, border: "none", boxShadow: badAt("title") ? `inset 0 0 0 2px ${T.late}` : "none", padding: "2px 6px", marginLeft: -6, background: "transparent" }} />
        </div>
        {saved ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: T.ok, fontWeight: 600 }}>Saved</span> : null}
        <button type="button" style={s.ghost} disabled={saving} onClick={() => setConfirmOpen(true)}>Open</button>
        <button type="button" style={s.solid} disabled={saving} onClick={() => save(false)}>Save</button>
        {confirmOpen ? <OpenConfirm T={T} title={form.title} questions={form.questions.length} onCancel={() => setConfirmOpen(false)} onOpen={() => { setConfirmOpen(false); save(true); }} /> : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px", gap: 24, padding: "24px 32px 80px", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {form.questions.map((q, i) => (
            <div key={q.key} style={{ ...s.card, padding: 20, display: "flex", flexDirection: "column", gap: 14, boxShadow: `0 0 0 1px ${badAt(i) ? T.late : T.line}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontFamily: T.mono, fontSize: SIZE.body, color: T.faint, width: 24 }}>{i + 1}</span>
                <Segmented T={T} value={q.answer} options={[["choice", "Multiple choice"], ["typed", "Free-form"]]} onChange={v => setQ(i, { answer: v, correct: [] })} />
                <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  <button type="button" aria-label={`Move question ${i + 1} up`} style={s.icon} onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                  <button type="button" aria-label={`Move question ${i + 1} down`} style={s.icon} onClick={() => move(i, 1)} disabled={i === form.questions.length - 1}>↓</button>
                  <button type="button" aria-label={`Remove question ${i + 1}`} style={s.icon} onClick={() => set({ questions: form.questions.length > 1 ? form.questions.filter((_, n) => n !== i) : [blank()] })}>×</button>
                </span>
              </div>
              <textarea value={q.text} rows={2} aria-label={`Question ${i + 1}`} onChange={e => setQ(i, { text: e.target.value })}
                style={{ ...s.input, fontSize: SIZE.lead, resize: "vertical", lineHeight: 1.35, boxShadow: `inset 0 0 0 ${badAt(i, "text") ? 2 : 1}px ${badAt(i, "text") ? T.late : T.line}` }} />
              <label style={{ display: "flex", alignItems: "center", gap: 10, color: T.dim }}>
                <span style={{ width: 64, flex: "none" }}>Image</span>
                <input value={q.image} onChange={e => setQ(i, { image: e.target.value })} placeholder="https://" style={{ ...s.input, fontSize: 16 }} />
              </label>
              {q.image ? <img src={q.image} alt="" style={{ maxWidth: 240, maxHeight: 160, objectFit: "contain", borderRadius: T.radius, alignSelf: "flex-start" }} /> : null}

              {q.answer === "choice" ? (
                <div role="radiogroup" aria-label={`Right answer for question ${i + 1}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {q.options.map((o, n) => {
                    const on = q.correct[0] === n;
                    return (
                      <div key={n} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <button type="button" role="radio" aria-checked={on} aria-label={`${LETTERS[n]} is right`} onClick={() => setQ(i, { correct: [n] })}
                          style={{ ...s.icon, width: HIT, fontFamily: T.mono, fontWeight: 600, background: on ? T.ok : T.panel, color: on ? "#ffffff" : T.dim, boxShadow: on ? "none" : `inset 0 0 0 1px ${badAt(i, "correct") ? T.late : T.line}` }}>
                          {LETTERS[n]}
                        </button>
                        <input value={o} aria-label={`Option ${LETTERS[n]}`} onChange={e => setQ(i, { options: q.options.map((x, m) => (m === n ? e.target.value : x)) })}
                          style={{ ...s.input, fontSize: 16, boxShadow: `inset 0 0 0 1px ${on ? T.ok : T.line}` }} />
                        {q.options.length > 2 ? (
                          <button type="button" aria-label={`Remove option ${LETTERS[n]}`} style={s.icon}
                            onClick={() => setQ(i, { options: q.options.filter((_, m) => m !== n), correct: q.correct[0] === n ? [] : q.correct[0] > n ? [q.correct[0] - 1] : q.correct })}>×</button>
                        ) : null}
                      </div>
                    );
                  })}
                  {q.options.length < 6 ? (
                    <button type="button" style={{ ...s.quiet, alignSelf: "flex-start", paddingLeft: HIT + 10 }} onClick={() => setQ(i, { options: [...q.options, ""] })}>Add option</button>
                  ) : null}
                </div>
              ) : (
                <label style={{ display: "flex", alignItems: "center", gap: 10, color: T.dim }}>
                  <span style={{ width: 64, flex: "none" }}>Accept</span>
                  <input value={q.accepted} onChange={e => setQ(i, { accepted: e.target.value })}
                    style={{ ...s.input, fontSize: 16, boxShadow: `inset 0 0 0 1px ${T.ok}` }} />
                </label>
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={s.ghost} onClick={() => set({ questions: [...form.questions, blank("choice")] })}>Add multiple choice</button>
            <button type="button" style={s.ghost} onClick={() => set({ questions: [...form.questions, blank("typed")] })}>Add free-form</button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 24 }}>
          <div style={{ ...s.card, overflow: "hidden" }}>
            <Row T={T} label="Individual or teams">
              <Segmented T={T} value={form.teams === "none" ? "none" : "teams"} options={[["none", "Individual"], ["teams", "Teams"]]}
                onChange={v => set({ teams: v === "none" ? "none" : "phone" })} />
            </Row>
            {form.teams !== "none" ? (
              <Row T={T} label="Teams">
                <Segmented T={T} value={form.teams} options={[["panel", "Set here"], ["phone", "Picked by phone"]]} onChange={v => set({ teams: v })} />
              </Row>
            ) : null}
            <Row T={T} label="Time">
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {form.timeOn ? (
                  <>
                    <input type="number" min="1" max="240" value={form.minutes} aria-label="Minutes" onChange={e => set({ minutes: e.target.value })} style={{ ...s.input, width: 72, fontFamily: T.mono, fontSize: 16 }} />
                    <span style={{ color: T.faint }}>min</span>
                  </>
                ) : null}
                <Toggle T={T} on={form.timeOn} label="Time" onChange={v => set({ timeOn: v })} />
              </span>
            </Row>
            <Row T={T} label="Closes at">
              <input type="datetime-local" value={form.closesAt} onChange={e => set({ closesAt: e.target.value })} style={{ ...s.input, width: 200, fontSize: 16 }} />
            </Row>
            <Row T={T} label="Gradebook" last>
              <Toggle T={T} on={form.gradebook} label="Gradebook" onChange={v => set({ gradebook: v })} />
            </Row>
          </div>

          {form.teams === "panel" ? (
            <TeamsEditor T={T} rows={form.teamRows} roster={roster} onChange={teamRows => set({ teamRows })} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Open asks first, like Close: opening puts the game in front of every student at once. */
export function OpenConfirm({ T, title, questions, onCancel, onOpen }) {
  const s = setupStyles(T);
  return (
    <div role="dialog" aria-label={`Open ${title}`}
      style={{ position: "absolute", top: "calc(100% - 8px)", right: 32, width: 320, zIndex: 5, ...s.card, boxShadow: `0 0 0 1px ${T.line}, 0 16px 40px -16px rgba(28,25,23,.3)`, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: SIZE.body, fontWeight: 600 }}>Open {title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", fontSize: SIZE.small }}>
        <span style={{ color: T.dim }}>Questions</span><span style={{ fontFamily: T.mono }}>{questions}</span>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" style={s.quiet} onClick={onCancel}>Cancel</button>
        <button type="button" style={s.solid} onClick={onOpen}>Open</button>
      </div>
    </div>
  );
}

function setupStyles(T) {
  const btn = { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: HIT, padding: "0 14px", borderRadius: T.radius, fontFamily: T.font, fontSize: SIZE.small, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", border: "none" };
  return {
    ghost: { ...btn, background: T.panel, color: T.accent, boxShadow: `inset 0 0 0 1px ${T.line}` },
    solid: { ...btn, background: T.accent, color: "#ffffff" },
    quiet: { ...btn, background: "transparent", color: T.accent },
    icon: { ...btn, width: HIT, padding: 0, background: "transparent", color: T.dim, fontSize: SIZE.body },
    card: { background: T.panel, borderRadius: T.radiusLarge, boxShadow: `0 0 0 1px ${T.line}` },
    input: { width: "100%", minHeight: HIT + 6, padding: "6px 10px", borderRadius: 8, border: "none", boxShadow: `inset 0 0 0 1px ${T.line}`, background: T.panel, color: T.text, fontFamily: T.font, outline: "none" },
  };
}

const Row = ({ T, label, children, last }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 56, padding: "0 20px", boxShadow: last ? "none" : `0 1px 0 ${T.line}` }}>
    <span>{label}</span>{children}
  </div>
);

function Segmented({ T, value, options, onChange }) {
  return (
    <span role="radiogroup" style={{ display: "inline-flex", padding: 3, borderRadius: T.radius, background: T.panel2 }}>
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          style={{ minHeight: 30, padding: "0 12px", border: "none", borderRadius: 9, cursor: "pointer", fontFamily: T.font, fontSize: SIZE.small, fontWeight: 500,
            background: value === v ? T.panel : "transparent", color: value === v ? T.text : T.dim, boxShadow: value === v ? "0 1px 3px rgba(28,25,23,.12)" : "none" }}>
          {label}
        </button>
      ))}
    </span>
  );
}

const Toggle = ({ T, on, label, onChange }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
    style={{ width: 44, height: 26, borderRadius: 999, border: "none", padding: 0, cursor: "pointer", position: "relative", background: on ? T.accent : T.ghost }}>
    <span style={{ position: "absolute", top: 4, left: on ? 22 : 4, width: 18, height: 18, borderRadius: 999, background: "#ffffff" }} />
  </button>
);

function TeamsEditor({ T, rows, roster, onChange }) {
  const s = setupStyles(T);
  const taken = new Map();
  rows.forEach((t, i) => t.members.forEach(m => taken.set(m, i)));
  const setRow = (i, patch) => onChange(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <div style={{ ...s.card, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <span style={{ fontSize: SIZE.body, fontWeight: 600 }}>Teams</span>
      {rows.map((t, i) => (
        <div key={t.id || i} style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 12, boxShadow: `0 1px 0 ${T.line}` }}>
          <span style={{ display: "flex", gap: 8 }}>
            <input value={t.name} aria-label={`Team ${i + 1}`} onChange={e => setRow(i, { name: e.target.value })} style={{ ...s.input, fontSize: 16 }} />
            <button type="button" aria-label={`Remove team ${i + 1}`} style={s.icon} onClick={() => onChange(rows.filter((_, n) => n !== i))}>×</button>
          </span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {roster.map(p => {
              const mine = t.members.includes(p.id);
              const elsewhere = !mine && taken.has(p.id);
              if (elsewhere) return null;
              return (
                <button key={p.id} type="button" aria-pressed={mine}
                  onClick={() => setRow(i, { members: mine ? t.members.filter(m => m !== p.id) : [...t.members, p.id] })}
                  style={{ minHeight: 30, padding: "0 10px", borderRadius: 999, border: "none", cursor: "pointer", fontFamily: T.font, fontSize: SIZE.micro,
                    background: mine ? T.accent : T.panel2, color: mine ? "#ffffff" : T.dim }}>
                  {p.name}
                </button>
              );
            })}
          </span>
        </div>
      ))}
      <button type="button" style={{ ...s.ghost, alignSelf: "flex-start" }} onClick={() => onChange([...rows, { name: "", members: [] }])}>Add team</button>
    </div>
  );
}
