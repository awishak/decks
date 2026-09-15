// The host's reads and writes for a game: everything the game panel does.
//
// The database lets these through only for a host (deck_hosts, 004). Each
// write touches one row: accepting an answer adds a row to deck_accepts rather
// than rewriting anyone's score, which is why every score, the ranking and
// released scores move on their own.

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

/** Everything the panel draws, for one game. */
export async function loadHostGame(sb, { deckId }) {
  const one = async (table, what, build = q => q) =>
    must(await build(sb.from(table).select("*").eq("deck_id", deckId)), what) || [];
  const deck = (must(await sb.from("decks").select("*").eq("id", deckId), "loadHostGame/deck") || [])[0] || null;
  if (!deck) return null;
  const [cards, keyRows, accepts, responses, progress, teams, extra] = await Promise.all([
    one("deck_cards", "loadHostGame/cards", q => q.is("retired_at", null).order("position", { ascending: true })),
    one("deck_keys", "loadHostGame/keys"),
    one("deck_accepts", "loadHostGame/accepts"),
    one("deck_responses", "loadHostGame/responses"),
    one("deck_progress", "loadHostGame/progress"),
    one("deck_teams", "loadHostGame/teams"),
    one("deck_extra_time", "loadHostGame/extra"),
  ]);
  const keys = Object.fromEntries(keyRows.map(k => [k.card_id, k.correct]));
  return { deck, cards: cards.filter(c => c.type === "question"), keys, accepts, responses, progress, teams, extra };
}

export async function acceptAnswer(sb, { deckId, cardId, value }) {
  return mustWrite(await sb.from("deck_accepts").insert({ deck_id: deckId, card_id: cardId, value }).select(), "acceptAnswer")[0];
}

export async function openGame(sb, { deckId }) {
  return mustWrite(await sb.from("decks").update({ published: true, opened_at: new Date().toISOString() }).eq("id", deckId).select(), "openGame")[0];
}

export async function closeGame(sb, { deckId }) {
  return mustWrite(await sb.from("decks").update({ closed_at: new Date().toISOString() }).eq("id", deckId).select(), "closeGame")[0];
}

/** kind: "scores" or "answers". */
export async function release(sb, { deckId, kind }) {
  const col = kind === "answers" ? "answers_released_at" : "scores_released_at";
  return mustWrite(await sb.from("decks").update({ [col]: new Date().toISOString() }).eq("id", deckId).select(), "release")[0];
}

/** Let a student take the game later, with the minutes given. Giving minutes again replaces them. */
export async function grantExtraTime(sb, { deckId, viewerId, minutes }) {
  const res = await sb.from("deck_extra_time").insert({ deck_id: deckId, viewer_id: viewerId, minutes }).select();
  if (res.error?.code === "23505") {
    return mustWrite(await sb.from("deck_extra_time").update({ minutes }).eq("deck_id", deckId).eq("viewer_id", viewerId).select(), "grantExtraTime")[0];
  }
  return mustWrite(res, "grantExtraTime")[0];
}

/**
 * Calls onChange whenever a game's answers, progress, accepts or the deck itself
 * change. Uses Supabase realtime where the client has it, and polls every two
 * seconds where it does not (the local preview's fake client). Returns a stop
 * function.
 */
export function watchGame(sb, { deckId, onChange }) {
  if (typeof sb.channel === "function") {
    const channel = sb.channel(`game-${deckId}`);
    for (const table of ["deck_responses", "deck_progress", "deck_accepts", "deck_extra_time", "deck_teams"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `deck_id=eq.${deckId}` }, onChange);
    }
    channel.on("postgres_changes", { event: "*", schema: "public", table: "decks", filter: `id=eq.${deckId}` }, onChange);
    channel.subscribe();
    return () => { sb.removeChannel?.(channel); };
  }
  const id = setInterval(onChange, 2000);
  return () => clearInterval(id);
}
