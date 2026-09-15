// The host's reads and writes for a game: everything the game panel does.
//
// The database lets these through only for a host (deck_hosts, 004). Each
// write touches one row: accepting an answer adds a row to deck_accepts rather
// than rewriting anyone's score, which is why every score, the ranking and
// released scores move on their own.

import { scoreGame } from "./score.js";

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
    allRows(() => sb.from("deck_responses").select("*").eq("deck_id", deckId).order("id", { ascending: true }), "loadHostGame/responses"),
    one("deck_progress", "loadHostGame/progress"),
    one("deck_teams", "loadHostGame/teams"),
    one("deck_extra_time", "loadHostGame/extra"),
  ]);
  const keys = Object.fromEntries(keyRows.map(k => [k.card_id, k.correct]));
  return { deck, cards: cards.filter(c => c.type === "question"), keys, accepts, responses, progress, teams, extra };
}

/** Every game for a group (a class), newest first, with how many questions each has. */
export async function listGames(sb, { groupKey }) {
  const decks = (must(await sb.from("decks").select("*").eq("group_key", groupKey).eq("kind", "game").order("created_at", { ascending: false }), "listGames") || [])
    .filter(d => d.kind === "game");
  if (!decks.length) return [];
  const cards = must(await sb.from("deck_cards").select("id, deck_id, type").in("deck_id", decks.map(d => d.id)).is("retired_at", null), "listGames/cards") || [];
  return decks.map(d => ({ ...d, questions: cards.filter(c => c.deck_id === d.id && c.type === "question").length }));
}

// Every row a query matches, a page at a time: Supabase hands back at most a
// thousand rows per request, and a long game in a big class has more answers.
async function allRows(build, what, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const q = build();
    const res = await (typeof q.range === "function" ? q.range(from, from + page - 1) : q);
    const rows = must(res, what) || [];
    out.push(...rows);
    if (typeof q.range !== "function" || rows.length < page) return out;
  }
}

/**
 * A group's games with what the games list shows for each: questions, when it
 * last ran, how many finished, and the average score.
 * Each: { ...deck, questions, finished, teamsCount, average, players }
 */
export async function listGameStats(sb, { groupKey }) {
  const games = await listGames(sb, { groupKey });
  if (!games.length) return [];
  const ids = games.map(g => g.id);
  const [cards, keyRows, accepts, progress, teams] = await Promise.all([
    allRows(() => sb.from("deck_cards").select("id, deck_id, type, position, config").in("deck_id", ids).is("retired_at", null), "stats/cards"),
    allRows(() => sb.from("deck_keys").select("card_id, correct").in("deck_id", ids), "stats/keys"),
    allRows(() => sb.from("deck_accepts").select("card_id, value, deck_id").in("deck_id", ids), "stats/accepts"),
    allRows(() => sb.from("deck_progress").select("deck_id, viewer_id, completed_at").in("deck_id", ids), "stats/progress"),
    allRows(() => sb.from("deck_teams").select("id, deck_id").in("deck_id", ids), "stats/teams"),
  ]);
  const keys = Object.fromEntries(keyRows.map(k => [k.card_id, k.correct]));
  const responses = await Promise.all(games.map(d =>
    d.opened_at ? allRows(() => sb.from("deck_responses").select("id, card_id, viewer_id, answer").eq("deck_id", d.id).order("id", { ascending: true }), "stats/responses") : []));
  return games.map((d, i) => {
    const mine = cards.filter(c => c.deck_id === d.id && c.type === "question");
    const score = scoreGame({ cards: mine, keys, accepts: accepts.filter(a => a.deck_id === d.id), responses: responses[i] });
    const done = progress.filter(p => p.deck_id === d.id && p.completed_at);
    return {
      ...d,
      questions: mine.length,
      finished: done.length,
      teamsCount: teams.filter(t => t.deck_id === d.id).length,
      average: score.ranking.length ? score.average : null,
      players: score.ranking.map(v => v.viewerId),
    };
  });
}

export async function createGame(sb, { groupKey, title }) {
  return mustWrite(await sb.from("decks").insert({
    key: `${groupKey}-game-${Date.now().toString(36)}`, title: title.trim(), group_key: groupKey,
    kind: "game", published: false, teams: "none", created_at: new Date().toISOString(),
  }).select(), "createGame")[0];
}

/**
 * Save a game from the setup screen: its settings, its questions in order, and
 * each question's right answers. A question taken out is retired, never
 * deleted, so nothing that points at it breaks.
 *
 * questions: [{ id?, text, image, answer: 'choice'|'typed', options, correct }]
 *   choice: correct is [option index]; typed: correct is the accepted answers.
 */
export async function saveGame(sb, { deckId, settings, questions, existingIds = [] }) {
  if (settings && Object.keys(settings).length) {
    mustWrite(await sb.from("decks").update(settings).eq("id", deckId).select(), "saveGame/deck");
  }
  const kept = new Set();
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const config = { text: q.text.trim(), answer: q.answer, ...(q.image ? { image: q.image.trim() } : {}),
      ...(q.answer === "choice" ? { options: q.options.map(o => o.trim()) } : {}) };
    let id = q.id;
    if (id) {
      mustWrite(await sb.from("deck_cards").update({ position: i, config }).eq("id", id).select(), "saveGame/card");
    } else {
      const key = `q-${Date.now().toString(36)}-${i}`;
      id = mustWrite(await sb.from("deck_cards").insert({ deck_id: deckId, position: i, type: "question", key, config }).select(), "saveGame/newCard")[0].id;
    }
    kept.add(id);
    mustWrite(await sb.from("deck_keys").upsert({ card_id: id, deck_id: deckId, correct: q.correct }, { onConflict: "card_id" }).select(), "saveGame/key");
  }
  for (const id of existingIds) {
    if (!kept.has(id)) {
      mustWrite(await sb.from("deck_cards").update({ retired_at: new Date().toISOString() }).eq("id", id).select(), "saveGame/retire");
    }
  }
}

/** Teams the host sets before a game opens. */
export async function saveTeams(sb, { deckId, teams, existing = [] }) {
  const kept = new Set();
  for (const t of teams) {
    if (t.id) {
      mustWrite(await sb.from("deck_teams").update({ name: t.name.trim(), members: t.members }).eq("id", t.id).select(), "saveTeams/update");
      kept.add(t.id);
    } else if (t.name.trim()) {
      kept.add(mustWrite(await sb.from("deck_teams").insert({ deck_id: deckId, name: t.name.trim(), members: t.members }).select(), "saveTeams/insert")[0].id);
    }
  }
  for (const t of existing) {
    if (!kept.has(t.id)) {
      // An unused team is removed outright: nobody has answered as it.
      must(await sb.from("deck_teams").delete().eq("id", t.id), "saveTeams/delete");
    }
  }
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
export function watchGame(sb, { deckId, onChange, every = 2000 }) {
  if (typeof sb.channel === "function") {
    const channel = sb.channel(`game-${deckId}`);
    for (const table of ["deck_responses", "deck_progress", "deck_accepts", "deck_extra_time", "deck_teams"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `deck_id=eq.${deckId}` }, onChange);
    }
    channel.on("postgres_changes", { event: "*", schema: "public", table: "decks", filter: `id=eq.${deckId}` }, onChange);
    channel.subscribe();
    return () => { sb.removeChannel?.(channel); };
  }
  const id = setInterval(onChange, every);
  return () => clearInterval(id);
}
