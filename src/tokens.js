// Design tokens. Host apps override by passing `theme` to <Deck>.
//
// One rule this file enforces: FLOOR is 13px and every size comes from SIZE.
// The Formula 5 recap broke its own floor in three places and only a grep
// caught it, so here the check is executable. See scripts/smoke.jsx.

export const FLOOR = 13;

export const SIZE = {
  head: 26,
  body: 18,
  label: 16,
  small: 14,
  micro: 13,
  stat: 48,
};

export const DEFAULT_THEME = {
  bg: "#f4f4f6",
  panel: "#ffffff",
  panel2: "#f0f0f3",
  text: "#1e1e2a",
  dim: "#6b6b80",
  faint: "#8a8a9e",
  line: "#d8d2c4",
  accent: "#6cb8e0",
  good: "#1aa855",
  bad: "#d4507a",
  font: "'DM Sans', system-ui, sans-serif",
  radius: 14,
};

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
