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
  const deniedFor = {};
  accepts.forEach(a => {
    if (isDenial(a.value)) (deniedFor[a.card_id] ||= []).push(a.value.denied);
    else (acceptedFor[a.card_id] ||= []).push(a.value);
  });

  const viewers = {};
  const questions = qs.map((card) => {
    const typed = card.config?.answer === "typed";
    const options = card.config?.options || [];
    const rows = responses.filter(r => r.card_id === card.id);
    const q = {
      cardId: card.id, key: card.key, text: card.config?.text || "", typed,
      answered: 0, right: 0, pct: 0, tough: false, reviews: 0, waiting: 0,
      // Which options count as right, by the key or accepted since: the panel colours these.
      correct: typed ? [] : [...(keys[card.id] || []), ...(acceptedFor[card.id] || [])].filter(Number.isInteger),
      counts: typed ? [] : options.map(() => 0),
      reviewBy: typed ? [] : options.map(() => 0),
      answers: typed ? [] : undefined,
    };
    rows.forEach((r) => {
      const value = valueOf(r);
      const right = isRight(value, keys[card.id], acceptedFor[card.id]);
      // A typed answer that matches nothing waits for the host, and waiting
      // answers stay out of every score and percentage until decided.
      const denied = typed && !right && (deniedFor[card.id] || []).some(d => norm(d) === norm(value));
      const waiting = typed && !right && !denied;
      const v = (viewers[r.viewer_id] ||= { right: 0, answered: 0, pct: 0, waiting: 0 });
      if (r.review) q.reviews += 1;
      if (typed) q.answers.push({ viewerId: r.viewer_id, value, right, denied, waiting, review: !!r.review, at: r.answered_at || null });
      if (waiting) { v.waiting += 1; q.waiting += 1; return; }
      v.answered += 1;
      q.answered += 1;
      if (right) { v.right += 1; q.right += 1; }
      if (typed) return;
      if (Number.isInteger(value) && value >= 0 && value < options.length) {
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
    .filter(([, v]) => v.answered > 0)   // someone whose every answer waits has no score yet
    .map(([viewerId, v]) => ({ viewerId, ...v }))
    .sort((a, b) => b.pct - a.pct || b.right - a.right || a.viewerId.localeCompare(b.viewerId));
  const average = ranking.length ? Math.round(ranking.reduce((s, v) => s + v.pct, 0) / ranking.length) : 0;

  return { viewers, ranking, questions, average };
}

// ─── the approval stream ───
//
// Typed answers that match no right answer come to the host in the order they
// arrived, and the host approves or denies each. A decision is a row in
// deck_accepts and holds for every answer with the same words, now and later:
// an approval's value is the answer itself, a denial's value is
// { denied: answer }. A denial can never count as right, in this file or in the
// database's deck_scores, because an object never compares equal to an answer.

export const isDenial = (v) => !!v && typeof v === "object" && typeof v.denied === "string";

/**
 * What waits for a decision, oldest first. The same words for the same question
 * are one entry, placed where the first of them arrived.
 * Each: { cardId, n, question, value, count, viewers, firstAt, closeTo }
 */
export function approvalStream(game) {
  const score = scoreGame(game);
  const acceptedFor = {};
  (game.accepts || []).forEach(a => { if (!isDenial(a.value)) (acceptedFor[a.card_id] ||= []).push(a.value); });
  const entries = new Map();
  score.questions.forEach((q, i) => {
    if (!q.typed) return;
    const targets = [...(game.keys?.[q.cardId] || []), ...(acceptedFor[q.cardId] || [])].filter(t => typeof t === "string");
    q.answers.filter(a => a.waiting).forEach(a => {
      const k = q.cardId + "|" + norm(a.value);
      const e = entries.get(k) || { cardId: q.cardId, n: i + 1, question: q.text, value: String(a.value).trim(), count: 0, viewers: [], firstAt: a.at, closeTo: targets.find(t => isClose(a.value, t)) ?? null };
      e.count += 1;
      e.viewers.push(a.viewerId);
      if (a.at && (!e.firstAt || a.at < e.firstAt)) e.firstAt = a.at;
      entries.set(k, e);
    });
  });
  return [...entries.values()].sort((a, b) => String(a.firstAt || "").localeCompare(String(b.firstAt || "")) || a.n - b.n);
}

/** The latest approvals and denials of typed answers, newest first, for Undo. */
export function recentVerdicts(game, limit = 8) {
  const cards = (game.cards || []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return (game.accepts || [])
    .filter(a => {
      const card = cards.find(c => c.id === a.card_id);
      return card?.config?.answer === "typed";
    })
    .sort((a, b) => String(b.accepted_at || "").localeCompare(String(a.accepted_at || "")))
    .slice(0, limit)
    .map(a => ({
      id: a.id, cardId: a.card_id, n: cards.findIndex(c => c.id === a.card_id) + 1,
      value: isDenial(a.value) ? a.value.denied : String(a.value), verdict: isDenial(a.value) ? "denied" : "approved",
    }));
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
