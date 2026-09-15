// Built-in card bodies. Each one renders its config and reports an answer up.
//
// Deliberately plain. The shell owns layout, centring and the button; a card
// body owns nothing but its own controls.

import { SIZE } from "../tokens.js";
import { interpolate } from "../resolve.js";

const Head = ({ children, T }) => (
  <div style={{ fontFamily: T.font, fontWeight: 600, fontSize: SIZE.head,
    lineHeight: 1.28, letterSpacing: "-0.01em", maxWidth: 480, color: T.text }}>
    {children}
  </div>
);

// pre-wrap so a body written with paragraphs keeps them. Card text is authored
// as plain text in the database and a blank line is the only paragraph break an
// author has; without this they all ran together into one block.
const Body = ({ children, T }) => (
  <div style={{ fontFamily: T.font, fontSize: SIZE.body, lineHeight: 1.45,
    maxWidth: 460, color: T.dim, whiteSpace: "pre-wrap" }}>{children}</div>
);

function Choice({ label, selected, onClick, T }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 11, width: "100%",
      padding: "14px 16px", borderRadius: T.radius, cursor: "pointer",
      textAlign: "left", fontFamily: T.font, fontSize: SIZE.label,
      background: selected ? T.panel2 : T.panel,
      border: `1.5px solid ${selected ? T.accent : T.line}`,
      color: T.text,
    }}>
      <span aria-hidden style={{
        width: 18, height: 18, flexShrink: 0, borderRadius: 9,
        border: `2px solid ${selected ? T.accent : T.line}`,
        background: selected ? T.accent : "transparent",
      }} />
      {label}
    </button>
  );
}

const input = T => ({
  width: "100%", padding: "13px 15px", borderRadius: T.radius,
  border: `1.5px solid ${T.line}`, background: T.panel, color: T.text,
  fontFamily: T.font, fontSize: SIZE.label, outline: "none",
});

export const CARD_TYPES = {
  read: ({ config, data, T }) => (
    <>
      <Head T={T}>{interpolate(config.head, data)}</Head>
      {config.body && <Body T={T}>{interpolate(config.body, data)}</Body>}
    </>
  ),

  acknowledge: ({ config, data, answer, onAnswer, T }) => (
    <>
      <Head T={T}>{interpolate(config.head, data)}</Head>
      {config.body && <Body T={T}>{interpolate(config.body, data)}</Body>}
      <div style={{ width: "100%", maxWidth: 420 }}>
        <Choice T={T} label={config.label || "I confirm"}
          selected={answer === true} onClick={() => onAnswer(answer === true ? null : true)} />
      </div>
    </>
  ),

  pick_one: ({ config, data, answer, onAnswer, T }) => (
    <>
      <Head T={T}>{interpolate(config.head, data)}</Head>
      <div style={{ width: "100%", maxWidth: 420, display: "grid", gap: 9 }}>
        {(config.options || []).map(o => (
          <Choice key={o.value} T={T} label={o.label}
            selected={answer === o.value} onClick={() => onAnswer(o.value)} />
        ))}
      </div>
    </>
  ),

  pick_many: ({ config, data, answer, onAnswer, T }) => {
    const picked = Array.isArray(answer) ? answer : [];
    return (
      <>
        <Head T={T}>{interpolate(config.head, data)}</Head>
        <div style={{ width: "100%", maxWidth: 420, display: "grid", gap: 9 }}>
          {(config.options || []).map(o => (
            <Choice key={o.value} T={T} label={o.label} selected={picked.includes(o.value)}
              onClick={() => onAnswer(picked.includes(o.value)
                ? picked.filter(v => v !== o.value)
                : [...picked, o.value])} />
          ))}
        </div>
      </>
    );
  },

  free_text: ({ config, data, answer, onAnswer, T }) => (
    <>
      <Head T={T}>{interpolate(config.head, data)}</Head>
      <textarea
        value={answer || ""} rows={4} maxLength={config.maxLength || 1000}
        placeholder={config.placeholder || ""}
        onChange={e => onAnswer(e.target.value)}
        style={{ ...input(T), maxWidth: 420, resize: "vertical", lineHeight: 1.45 }}
      />
    </>
  ),

  link: ({ config, data, answer, onAnswer, T }) => (
    <>
      <Head T={T}>{interpolate(config.head, data)}</Head>
      {config.body && <Body T={T}>{interpolate(config.body, data)}</Body>}
      <input
        type="url" value={answer || ""} placeholder={config.placeholder || "https://"}
        onChange={e => onAnswer(e.target.value)}
        style={{ ...input(T), maxWidth: 420 }}
      />
    </>
  ),

  external: ({ config, data, T }) => (
    <>
      <Head T={T}>{interpolate(config.head, data)}</Head>
      {config.body && <Body T={T}>{interpolate(config.body, data)}</Body>}
      <a href={config.url} target="_blank" rel="noopener noreferrer"
        style={{ fontFamily: T.font, fontSize: SIZE.label, fontWeight: 700,
          color: T.accent }}>{config.linkLabel || "Open"}</a>
    </>
  ),
};
