// Design tokens. Host apps override by passing `theme` to <Deck> or <QuizDeck>.
//
// These follow ~/.claude/DESIGN.md, the one design system across every
// project, so a deck opening over the class site is in the same font and the
// same greys as the site behind it. Until 2026-09-14 this file had its own
// palette, its own font and its own scale, and four of its six colours failed
// 4.5:1.
//
// Two rules are executable here, because a comment saying them is what failed
// last time. FLOOR is 13px and every size comes from SIZE (assertFloor). Every
// colour that carries text clears 4.5:1 against every surface it sits on
// (assertContrast). scripts/smoke.jsx runs both.

export const FLOOR = 13;

// The design system's ladder. A deck fills a phone, so its body starts at lead.
export const SIZE = {
  micro: 13,   // the floor
  small: 15,
  body: 17,
  label: 17,   // buttons and options
  lead: 20,    // reading size on a card
  head: 26,    // a card's headline
  stat: 48,
};

export const DEFAULT_THEME = {
  bg: "#fafaf9",       // surface.page
  panel: "#ffffff",    // surface.card
  panel2: "#f6f4f1",   // surface.sunk
  text: "#1c1917",     // text.primary
  dim: "#57534e",      // text.secondary
  faint: "#6b655f",    // text.muted
  line: "#e3ded8",     // line.strong
  ghost: "#c9c2ba",    // line.ghost, never text
  accent: "#9f1239",   // what you can press; hosts pass their own
  accentTint: "#fdf2f4",
  ok: "#0f766e",       // state.ok
  okTint: "#ecf6f4",
  warn: "#b45309",     // state.warn: a tough question, an answer waiting on a tap
  warnTint: "#fdf5ea",
  late: "#c81e1e",     // state.late
  font: "'Outfit', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
  radius: 12,
  radiusLarge: 16,
};

// Older names, kept so a host theme written before the move still works.
DEFAULT_THEME.good = DEFAULT_THEME.ok;
DEFAULT_THEME.bad = DEFAULT_THEME.late;

export const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap";

export const TAP = 44;   // anywhere a finger lands

/** Throws on any size below the floor. Called by the test harness. */
export function assertFloor(sizes = SIZE) {
  const bad = Object.entries(sizes).filter(([, v]) => typeof v === "number" && v < FLOOR);
  if (bad.length) {
    throw new Error(
      `type below the ${FLOOR}px floor: ${bad.map(([k, v]) => `${k}=${v}`).join(", ")}`,
    );
  }
  return true;
}

const lum = (hex) => {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Throws on any text colour under 4.5:1 against a surface it sits on. */
export function assertContrast(T = DEFAULT_THEME) {
  const surfaces = { bg: T.bg, panel: T.panel, panel2: T.panel2, accentTint: T.accentTint, okTint: T.okTint, warnTint: T.warnTint };
  const pairs = [
    ...["text", "dim", "faint", "accent"].flatMap(c => Object.keys(surfaces).map(s => [c, s])),
    ["ok", "panel"], ["ok", "okTint"], ["ok", "bg"], ["late", "panel"], ["late", "bg"],
    ["warn", "panel"], ["warn", "bg"], ["warn", "panel2"], ["warn", "warnTint"],
  ];
  const bad = pairs
    .map(([c, s]) => [c, s, contrast(T[c], surfaces[s])])
    .filter(([, , r]) => r < 4.5);
  if (contrast("#ffffff", T.accent) < 4.5) bad.push(["white", "accent", contrast("#ffffff", T.accent)]);
  if (bad.length) {
    throw new Error("under 4.5:1: " + bad.map(([c, s, r]) => `${c} on ${s} ${r.toFixed(2)}`).join(", "));
  }
  return true;
}
