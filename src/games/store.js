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
