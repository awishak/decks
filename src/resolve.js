// Pure deck logic. No React, no Supabase, no DOM.
//
// This file is where the bugs would otherwise live, so it is deliberately
// separable and directly testable. Branching plus every-card-required plus
// resume is the combination that goes wrong.

/** Cards that are actually servable, in order. Retired cards are skipped. */
export function liveCards(deck) {
  return deck.cards
    .filter(c => !c.retired_at)
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/**
 * The card after `fromKey`, honouring branches.
 *
 * Branch targets are card KEYS, not positions, because positions move and a
 * reorder must never redirect someone mid-deck. A branch pointing at a retired
 * or unknown card falls through to the next live card rather than dead-ending,
 * which is the whole reason retiring is a soft delete.
 */
export function nextCard(deck, fromKey, answer) {
  const cards = liveCards(deck);
  const i = cards.findIndex(c => c.key === fromKey);
  if (i === -1) return cards[0] ?? null;

  const branches = cards[i].branches;
  if (branches && answer !== undefined) {
    const hit = branches.find(b => b.when === answer);
    if (hit) {
      const target = cards.find(c => c.key === hit.goto);
      if (target) return target;
      // Target retired or misspelled. Fall through rather than trap the viewer.
    }
  }
  return cards[i + 1] ?? null;
}

/** Card types that require an answer before the viewer can advance. */
const NEEDS_ANSWER = new Set([
  "acknowledge", "pick_one", "pick_many", "free_text", "link",
]);

export function requiresAnswer(card) {
  return NEEDS_ANSWER.has(card.type);
}

/**
 * Is `answer` good enough to advance past `card`?
 *
 * Every card is required, so this is the gate. Kept separate from the UI so a
 * test can assert it without rendering anything.
 */
export function isSatisfied(card, answer) {
  if (!requiresAnswer(card)) return true;
  switch (card.type) {
    case "acknowledge": return answer === true;
    case "pick_one":    return typeof answer === "string" && answer.length > 0;
    case "pick_many":   return Array.isArray(answer) && answer.length > 0;
    case "free_text":   return typeof answer === "string" && answer.trim().length > 0;
    case "link":        return typeof answer === "string" && /^https?:\/\/\S+$/i.test(answer.trim());
    default:            return true;
  }
}

/**
 * Where a returning viewer picks up.
 *
 * Replays their stored answers through the branch rules rather than trusting a
 * saved index, so a deck edited since they started still lands them somewhere
 * real. Returns null when the deck is finished.
 */
export function resumeAt(deck, answers = {}) {
  const cards = liveCards(deck);
  if (!cards.length) return null;

  let card = cards[0];
  const guard = new Set();
  while (card) {
    if (guard.has(card.key)) return card;      // cycle in branches; stop here
    guard.add(card.key);

    const answer = answers[card.key];
    if (!isSatisfied(card, answer)) return card;
    // A read card with no stored answer has not been seen yet.
    if (!requiresAnswer(card) && !(card.key in answers)) return card;

    card = nextCard(deck, card.key, answer);
  }
  return null;                                  // finished
}

export function isComplete(deck, answers = {}) {
  return resumeAt(deck, answers) === null;
}

/** Fill `{token}` from a flat data object. Unknown tokens are left visible. */
export function interpolate(text, data = {}) {
  if (typeof text !== "string") return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m));
}
