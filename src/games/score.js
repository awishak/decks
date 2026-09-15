// Scoring a game, as plain functions. No React, no Supabase.
//
// The database scores too (deck_scores in 003_games.sql), for students once
// scores are released. This file is what the game panel and the room screen
// read, live, from the rows they already hold. The two must agree, so the one
// rule that could drift, how answers compare, is written the same way in both:
// case, outer spaces, punctuation and repeated spaces do not count.
//
// Shapes:
//   cards     [{ id, key, position, config: { text, answer: 'choice'|'typed', options } }]
//   keys      { [cardId]: [correct, ...] }     choice: option indexes; typed: strings
//   accepts   [{ card_id, value }]             answers the host accepted later
//   responses [{ card_id, viewer_id, answer: { value }, review }]

export const TOUGH_BELOW = 50;   // percent right under which a question is marked tough

/** Mirrors deck_norm() in 003_games.sql. */
export function norm(value) {
  if (typeof value === "string") {
    return value.trim().toLowerCase().replace(/[\p{P}\p{S}]+/gu, "").replace(/\s+/g, " ").trim();
  }
  return String(value);
}

const valueOf = (r) => (r?.answer && typeof r.answer === "object" && "value" in r.answer ? r.answer.value : r?.answer);

/** Whether one answer is right, by the key or anything accepted since. */
export function isRight(value, correct = [], accepted = []) {
  const n = norm(value);
  return correct.some(c => norm(c) === n) || accepted.some(a => norm(a) === n);
}

const pct = (right, of) => (of ? Math.round((100 * right) / of) : 0);

/**
 * Everything the panel and the wall show about a game, from its rows.
 *
 * viewers:   { [viewerId]: { right, answered, pct } }, pct out of questions answered so far
 * ranking:   viewers as a list, best first
 * questions: per card, in order: answered, right, pct, tough, reviews, and for a
 *            choice question counts[] and reviewBy[] per option; for a typed
 *            question the answers themselves
 * average:   the class average of pct, over viewers who answered anything
 */
export function scoreGame({ cards = [], keys = {}, accepts = [], responses = [] }) {
  const qs = cards.filter(c => c.type === undefined || c.type === "question")
    .slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const acceptedFor = {};
  accepts.forEach(a => { (acceptedFor[a.card_id] ||= []).push(a.value); });

  const viewers = {};
  const questions = qs.map((card) => {
    const typed = card.config?.answer === "typed";
    const options = card.config?.options || [];
    const rows = responses.filter(r => r.card_id === card.id);
    const q = {
      cardId: card.id, key: card.key, text: card.config?.text || "", typed,
      answered: rows.length, right: 0, pct: 0, tough: false, reviews: 0,
      counts: typed ? [] : options.map(() => 0),
      reviewBy: typed ? [] : options.map(() => 0),
      answers: typed ? [] : undefined,
    };
    rows.forEach((r) => {
      const value = valueOf(r);
      const right = isRight(value, keys[card.id], acceptedFor[card.id]);
      const v = (viewers[r.viewer_id] ||= { right: 0, answered: 0, pct: 0 });
      v.answered += 1;
      if (right) { v.right += 1; q.right += 1; }
      if (r.review) q.reviews += 1;
      if (typed) q.answers.push({ viewerId: r.viewer_id, value, right, review: !!r.review });
      else if (Number.isInteger(value) && value >= 0 && value < options.length) {
        q.counts[value] += 1;
        if (r.review) q.reviewBy[value] += 1;
      }
    });
    q.pct = pct(q.right, q.answered);
    q.tough = q.answered > 0 && q.pct < TOUGH_BELOW;
    return q;
  });

  Object.values(viewers).forEach(v => { v.pct = pct(v.right, v.answered); });
  const ranking = Object.entries(viewers)
    .map(([viewerId, v]) => ({ viewerId, ...v }))
    .sort((a, b) => b.pct - a.pct || b.right - a.right || a.viewerId.localeCompare(b.viewerId));
  const average = ranking.length ? Math.round(ranking.reduce((s, v) => s + v.pct, 0) / ranking.length) : 0;

  return { viewers, ranking, questions, average };
}

/** What changes if the host accepts `value` on one card: shown before Accept is pressed. */
export function previewAccept(game, cardId, value) {
  const before = scoreGame(game);
  const after = scoreGame({ ...game, accepts: [...(game.accepts || []), { card_id: cardId, value }] });
  const qb = before.questions.find(q => q.cardId === cardId);
  const qa = after.questions.find(q => q.cardId === cardId);
  const up = after.ranking.filter(v => v.right > (before.viewers[v.viewerId]?.right ?? 0)).length;
  return { questionBefore: qb?.pct ?? 0, questionAfter: qa?.pct ?? 0, averageBefore: before.average, averageAfter: after.average, scoresUp: up };
}

// ─── typed answers ───

const ARTICLE = /^(the|a|an)\s+/;

function distance(a, b) {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const hold = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = hold;
    }
  }
  return row[b.length];
}

/** Close enough to put beside an accepted answer for one tap: a slip, not a different answer. */
export function isClose(value, target) {
  const a = norm(value).replace(ARTICLE, "");
  const b = norm(target).replace(ARTICLE, "");
  if (!a || !b) return false;
  if (a === b) return true;
  const allowed = Math.max(1, Math.floor(Math.max(a.length, b.length) / 5));
  return distance(a, b) <= allowed;
}

/**
 * A typed question's answers in the three groups the panel shows:
 *   right  answers that match the key or an accepted answer
 *   close  { to, answers }: answers a slip away from one accepted answer
 *   other  everything else
 */
export function groupTyped(answers, correct = [], accepted = []) {
  const targets = [...correct, ...accepted];
  const right = [], other = [];
  const close = new Map();
  answers.forEach((a) => {
    if (isRight(a.value, correct, accepted)) { right.push(a); return; }
    const to = targets.find(t => isClose(a.value, t));
    if (to !== undefined) {
      if (!close.has(to)) close.set(to, []);
      close.get(to).push(a);
    } else other.push(a);
  });
  return { right, close: [...close].map(([to, list]) => ({ to, answers: list })), other };
}

// ─── time and the wall ───

/** "5 min" above a minute, counted up so the last minute never reads 0; "45 sec" inside it. */
export function timeLeft(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return s > 60 ? Math.ceil(s / 60) + " min" : s + " sec";
}

/** Seconds left for a viewer, or null when the game has no clock for them. */
export function secondsLeft({ startedAt, limitMin, now = Date.now() }) {
  if (!limitMin || !startedAt) return null;
  return (new Date(startedAt).getTime() + limitMin * 60000 - now) / 1000;
}

/** Spread of scores: how many viewers in each 10-point band, from the lowest band to 100. */
export function spreadBuckets(pcts, step = 10) {
  if (!pcts.length) return [];
  const band = (p) => Math.min(100, Math.floor(p / step) * step);
  const low = Math.min(...pcts.map(band));
  const out = [];
  for (let b = low; b <= 100; b += step) out.push({ from: b, count: pcts.filter(p => band(p) === b).length });
  return out;
}
