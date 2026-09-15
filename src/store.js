// Every Supabase read and write, in one place, as plain functions taking a
// client. Kept out of the component so the query shapes can be asserted against
// a fake client without rendering anything.
//
// EVERY WRITE APPENDS .select(). An RLS policy mismatch fails with no error, and
// this system writes on every card, so a swallowed write looks exactly like a
// student who never answered. If a write comes back with no row, that is a
// failure and it gets thrown, not logged and forgotten.

const T = {
  decks: "decks",
  cards: "deck_cards",
  responses: "deck_responses",
  progress: "deck_progress",
};

function must(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/** Wrote something but got nothing back means RLS ate it. */
function mustWrite(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (!res.data || (Array.isArray(res.data) && res.data.length === 0)) {
    throw new Error(
      `${what}: write returned no rows. This is almost always an RLS policy ` +
      `mismatch silently rejecting the insert.`,
    );
  }
  return res.data;
}

/**
 * Decks this viewer still owes, oldest first.
 *
 * Published, inside their date window, matching one of the viewer's groups, and
 * not already completed. Two queries rather than a join so the completed filter
 * stays readable and works without a view.
 */
export async function pendingDecks(sb, { viewerId, groups, now = new Date() }) {
  if (!groups?.length) return [];
  const iso = now.toISOString();

  const decks = (must(
    await sb.from(T.decks).select("*")
      .eq("published", true)
      .in("group_key", groups)
      .or(`starts_at.is.null,starts_at.lte.${iso}`)
      .or(`ends_at.is.null,ends_at.gte.${iso}`)
      .order("created_at", { ascending: true }),
    "pendingDecks/decks",
  ) || []).filter(d => (d.kind || "gate") === "gate");   // a game sits on the page; it never blocks the site

  if (!decks.length) return [];

  const done = must(
    await sb.from(T.progress).select("deck_id")
      .eq("viewer_id", viewerId)
      .not("completed_at", "is", null)
      .in("deck_id", decks.map(d => d.id)),
    "pendingDecks/progress",
  ) || [];

  const finished = new Set(done.map(p => p.deck_id));
  return decks.filter(d => !finished.has(d.id));
}

/** A deck's live cards plus whatever this viewer has already answered. */
export async function loadDeck(sb, { deckId, viewerId }) {
  const cards = must(
    await sb.from(T.cards).select("*")
      .eq("deck_id", deckId)
      .is("retired_at", null)
      .order("position", { ascending: true }),
    "loadDeck/cards",
  ) || [];

  const rows = must(
    await sb.from(T.responses).select("card_id, answer")
      .eq("deck_id", deckId)
      .eq("viewer_id", viewerId),
    "loadDeck/responses",
  ) || [];

  // The shell works in card keys; the table works in ids. Map here so neither
  // side has to know about the other.
  const byId = Object.fromEntries(cards.map(c => [c.id, c]));
  const answers = {};
  rows.forEach(r => {
    const card = byId[r.card_id];
    if (card) answers[card.key] = r.answer?.value ?? r.answer;
  });

  return { cards, answers };
}

export async function saveAnswer(sb, { deckId, cardId, viewerId, value }) {
  return mustWrite(
    await sb.from(T.responses)
      .upsert({
        deck_id: deckId, card_id: cardId, viewer_id: viewerId,
        answer: { value }, answered_at: new Date().toISOString(),
      }, { onConflict: "card_id,viewer_id" })
      .select(),
    "saveAnswer",
  );
}

export async function saveProgress(sb, { deckId, viewerId, currentCardId }) {
  return mustWrite(
    await sb.from(T.progress)
      .upsert({ deck_id: deckId, viewer_id: viewerId, current_card_id: currentCardId },
        { onConflict: "deck_id,viewer_id" })
      .select(),
    "saveProgress",
  );
}

export async function markComplete(sb, { deckId, viewerId }) {
  return mustWrite(
    await sb.from(T.progress)
      .upsert({
        deck_id: deckId, viewer_id: viewerId,
        completed_at: new Date().toISOString(),
      }, { onConflict: "deck_id,viewer_id" })
      .select(),
    "markComplete",
  );
}
