// A game's Supabase reads and writes, as plain functions taking a client.
//
// The rule the spring game broke: never read a shared record, change it and
// write it back. Every write here touches one row that belongs to one viewer,
// so two phones writing at the same moment cannot undo each other.
//
// Submit is an INSERT, not an upsert. The database has no update rule for a
// game answer (004_signed_in_rls.sql), so a submitted answer is final there,
// not only on the phone. Every write appends .select(): RLS refuses silently.

const T = {
  decks: "decks",
  cards: "deck_cards",
  responses: "deck_responses",
  progress: "deck_progress",
  teams: "deck_teams",
  extra: "deck_extra_time",
};

function must(res, what) {
  if (res.error) throw Object.assign(new Error(`${what}: ${res.error.message}`), { code: res.error.code });
  return res.data;
}

function mustWrite(res, what) {
  must(res, what);
  if (!res.data || (Array.isArray(res.data) && res.data.length === 0)) {
    throw Object.assign(new Error(`${what}: write returned no rows. The database refused it.`), { code: "refused" });
  }
  return res.data;
}

/** A game, its questions in order, and where this viewer (or their team) stands. */
export async function loadGame(sb, { deckId, viewerId }) {
  const deck = (must(await sb.from(T.decks).select("*").eq("id", deckId), "loadGame/deck") || [])[0] || null;
  if (!deck) return null;

  const cards = (must(
    await sb.from(T.cards).select("*").eq("deck_id", deckId).is("retired_at", null).order("position", { ascending: true }),
    "loadGame/cards",
  ) || []).filter(c => c.type === "question");

  // A team phone answers as the team. Find the team this viewer is on, if any.
  const teams = must(await sb.from(T.teams).select("*").eq("deck_id", deckId), "loadGame/teams") || [];
  const team = teams.find(t => (t.members || []).includes(viewerId)) || null;
  const speaksAs = team ? team.id : viewerId;

  const rows = must(
    await sb.from(T.responses).select("card_id, answer, review").eq("deck_id", deckId).eq("viewer_id", speaksAs),
    "loadGame/responses",
  ) || [];
  const progress = (must(
    await sb.from(T.progress).select("*").eq("deck_id", deckId).eq("viewer_id", speaksAs),
    "loadGame/progress",
  ) || [])[0] || null;
  const extra = (must(
    await sb.from(T.extra).select("*").eq("deck_id", deckId).eq("viewer_id", speaksAs),
    "loadGame/extra",
  ) || [])[0] || null;

  const byId = Object.fromEntries(cards.map(c => [c.id, c]));
  const answered = {};
  rows.forEach(r => {
    const card = byId[r.card_id];
    if (card) answered[card.key] = { value: r.answer?.value ?? r.answer, review: !!r.review };
  });

  return { deck, cards, team, teams, speaksAs, answered, progress, extra };
}

/**
 * A finished game, for the person who played it: the questions, what they put,
 * and the key if the host has released the answers.
 *
 * The key and anything accepted later are read plainly. A viewer who is not
 * allowed them yet gets no rows rather than an error (004_signed_in_rls.sql),
 * which is what an empty `keys` means to GameReview: their answers, no verdict.
 */
export async function loadReview(sb, { deckId, viewerId }) {
  const game = await loadGame(sb, { deckId, viewerId });
  if (!game) return null;

  const [keyRows, acceptRows] = await Promise.all([
    sb.from("deck_keys").select("card_id, correct").eq("deck_id", deckId),
    sb.from("deck_accepts").select("card_id, value").eq("deck_id", deckId),
  ]);
  const keys = {};
  (must(keyRows, "loadReview/keys") || []).forEach(k => { keys[k.card_id] = k.correct || []; });

  // Their answers by card id, which is what the review screen reads. loadGame
  // keys the same rows by card key, for the deck that asks the questions.
  const byKey = Object.fromEntries(game.cards.map(c => [c.key, c.id]));
  const mine = {};
  Object.entries(game.answered).forEach(([cardKey, row]) => {
    const id = byKey[cardKey];
    if (id) mine[id] = row;
  });

  return { deck: game.deck, cards: game.cards, mine, keys, accepts: must(acceptRows, "loadReview/accepts") || [], team: game.team };
}

/** Starts this viewer's clock, once. A second call leaves the first start alone. */
export async function startGame(sb, { deckId, viewerId }) {
  const existing = (must(
    await sb.from(T.progress).select("*").eq("deck_id", deckId).eq("viewer_id", viewerId),
    "startGame/read",
  ) || [])[0];
  if (existing) return existing;
  return mustWrite(
    await sb.from(T.progress).insert({ deck_id: deckId, viewer_id: viewerId }).select(),
    "startGame",
  )[0];
}

/**
 * Submit one answer. Resolves with the saved row.
 * Rejects with code "23505" when this question was already answered (a second
 * tab, a double tap), and with "refused" or "42501" when the game will not take
 * it: closed, out of time, or not this viewer's to give.
 */
export async function submitAnswer(sb, { deckId, cardId, viewerId, value, review = false }) {
  return mustWrite(
    await sb.from(T.responses)
      .insert({ deck_id: deckId, card_id: cardId, viewer_id: viewerId, answer: { value }, review: !!review })
      .select(),
    "submitAnswer",
  )[0];
}

export async function moveTo(sb, { deckId, viewerId, cardId }) {
  return mustWrite(
    await sb.from(T.progress).update({ current_card_id: cardId }).eq("deck_id", deckId).eq("viewer_id", viewerId).select(),
    "moveTo",
  );
}

export async function finishGame(sb, { deckId, viewerId }) {
  return mustWrite(
    await sb.from(T.progress).update({ completed_at: new Date().toISOString() }).eq("deck_id", deckId).eq("viewer_id", viewerId).select(),
    "finishGame",
  );
}

/** A team phone names its team. The phone's own viewer must be among the members. */
export async function createTeam(sb, { deckId, name, members }) {
  return mustWrite(
    await sb.from(T.teams).insert({ deck_id: deckId, name: name.trim(), members }).select(),
    "createTeam",
  )[0];
}
