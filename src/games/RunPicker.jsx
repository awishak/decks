// Run: choose the class or section, and the game opens to them.
//
// A game is built once and run for each class or section that plays it. The
// picker lists what the host app offers (every class this term, a class with
// two sections as two), marks any that already have this game open, and runs
// it for the one chosen. Nothing about an earlier run changes.
//
//   groups: [{ groupKey, section, label }]
//   openFor: [{ groupKey, section }]   groups with a run of this game still open

import { useState } from "react";
import { SIZE } from "../tokens.js";

const HIT = 34;
const same = (a, b) => a.groupKey === b.groupKey && (a.section || null) === (b.section || null);

export default function RunPicker({ T, groups = [], openFor = [], onRun, inline = false, label = "Run", solid = true }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(() => (groups.length === 1 ? 0 : -1));
  const [busy, setBusy] = useState(false);

  const btn = { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: HIT, padding: "0 14px", borderRadius: T.radius, fontFamily: T.font, fontSize: SIZE.small, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", border: "none" };
  const solidBtn = { ...btn, background: T.accent, color: "#ffffff" };
  const ghostBtn = { ...btn, background: T.panel, color: T.accent, boxShadow: `inset 0 0 0 1px ${T.line}` };
  const ready = pick >= 0 && !busy;

  const go = async () => {
    if (!ready) return;
    setBusy(true);
    try { await onRun(groups[pick]); setOpen(false); } finally { setBusy(false); }
  };

  const list = (
    <div role="radiogroup" aria-label="Class" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {groups.map((g, i) => {
        const on = pick === i;
        const running = openFor.some(o => same(o, g));
        return (
          <button key={g.groupKey + "|" + (g.section || "")} type="button" role="radio" aria-checked={on} onClick={() => setPick(i)}
            style={{ display: "flex", alignItems: "center", gap: 10, minHeight: HIT + 4, padding: "0 10px", borderRadius: 8, border: "none", textAlign: "left", cursor: "pointer",
              fontFamily: T.font, fontSize: SIZE.small, color: T.text, background: on ? T.panel2 : "transparent", boxShadow: on ? `inset 0 0 0 1px ${T.accent}` : "none" }}>
            <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 999, flex: "none", boxShadow: `inset 0 0 0 ${on ? 5 : 2}px ${on ? T.accent : T.ghost}` }} />
            <span style={{ flex: 1 }}>{g.label}</span>
            {running ? <span style={{ fontSize: SIZE.micro, fontWeight: 600, padding: "2px 8px", borderRadius: 999, color: T.ok, background: T.okTint }}>Open</span> : null}
          </button>
        );
      })}
    </div>
  );

  if (inline) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {list}
        <button type="button" disabled={!ready} onClick={go}
          style={{ ...solidBtn, alignSelf: "flex-end", ...(ready ? {} : { background: T.line, color: T.dim, cursor: "default" }) }}>{label}</button>
      </div>
    );
  }

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" style={solid ? solidBtn : ghostBtn} aria-expanded={open} onClick={() => setOpen(v => !v)}>{label}</button>
      {open ? (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div role="dialog" aria-label={label}
            style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 41, width: 300, padding: 12, borderRadius: T.radiusLarge, background: T.panel,
              boxShadow: `0 0 0 1px ${T.line}, 0 16px 40px -16px rgba(28,25,23,.3)`, display: "flex", flexDirection: "column", gap: 10 }}>
            {list}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" style={{ ...btn, background: "transparent", color: T.accent }} onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" disabled={!ready} onClick={go} style={{ ...solidBtn, ...(ready ? {} : { background: T.line, color: T.dim, cursor: "default" }) }}>{label}</button>
            </div>
          </div>
        </>
      ) : null}
    </span>
  );
}
