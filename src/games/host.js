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

/** Every game for a group (a class), newest first, with how many questions each has. Runs are not games. */
export async function listGames(sb, { groupKey }) {
  const decks = (must(await sb.from("decks").select("*").eq("group_key", groupKey).eq("kind", "game").order("created_at", { ascending: false }), "listGames") || [])
    .filter(d => d.kind === "game" && !d.source_id);
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

/** How one run went: finished, teams, the average and who played. */
async function runStats(sb, runIds) {
  if (!runIds.length) return {};
  const [cards, keyRows, accepts, progress, teams] = await Promise.all([
    allRows(() => sb.from("deck_cards").select("id, deck_id, type, position, config").in("deck_id", runIds).is("retired_at", null), "stats/cards"),
    allRows(() => sb.from("deck_keys").select("card_id, correct").in("deck_id", runIds), "stats/keys"),
    allRows(() => sb.from("deck_accepts").select("card_id, value, deck_id").in("deck_id", runIds), "stats/accepts"),
    allRows(() => sb.from("deck_progress").select("deck_id, viewer_id, completed_at").in("deck_id", runIds), "stats/progress"),
    allRows(() => sb.from("deck_teams").select("id, deck_id").in("deck_id", runIds), "stats/teams"),
  ]);
  const keys = Object.fromEntries(keyRows.map(k => [k.card_id, k.correct]));
  const responses = await Promise.all(runIds.map(id =>
    allRows(() => sb.from("deck_responses").select("id, card_id, viewer_id, answer").eq("deck_id", id).order("id", { ascending: true }), "stats/responses")));
  const out = {};
  runIds.forEach((id, i) => {
    const score = scoreGame({ cards: cards.filter(c => c.deck_id === id && c.type === "question"), keys, accepts: accepts.filter(a => a.deck_id === id), responses: responses[i] });
    out[id] = {
      finished: progress.filter(p => p.deck_id === id && p.completed_at).length,
      teamsCount: teams.filter(t => t.deck_id === id).length,
      average: score.ranking.length ? score.average : null,
      players: score.ranking.map(v => v.viewerId),
    };
  });
  return out;
}

/**
 * A group's games with what the games list shows for each, read off its latest
 * run: questions, when it last ran and for whom, how many finished, the average.
 * Each: { ...game, questions, lastRun, runs, finished, teamsCount, average, players }
 */
export async function listGameStats(sb, { groupKey }) {
  const games = await listGames(sb, { groupKey });
  if (!games.length) return [];
  const runs = must(await sb.from("decks").select("*").in("source_id", games.map(g => g.id)), "stats/runs") || [];
  const runsOf = (g) => [...runs.filter(r => r.source_id === g.id), ...(g.opened_at ? [g] : [])]
    .sort((a, b) => String(b.opened_at || "").localeCompare(String(a.opened_at || "")));
  const latest = games.map(g => runsOf(g)[0]).filter(Boolean);
  const stats = await runStats(sb, latest.map(r => r.id));
  return games.map(g => {
    const all = runsOf(g);
    const last = all[0] || null;
    return { ...g, runs: all.length, lastRun: last, ...(last ? stats[last.id] : { finished: 0, teamsCount: 0, average: null, players: [] }) };
  });
}

/** Stats for a list of runs, keyed by run id: the game page's table of its runs. */
export async function statsForRuns(sb, { runIds }) {
  return runStats(sb, runIds);
}

// ─── runs ───
//
// A game is its questions. Run makes a run: a copy of the game's questions and
// right answers, opened to one class or one section, which then holds that
// sitting's answers, approvals, closing and releases. A run is a snapshot, so
// editing the game afterwards changes the next run and never an earlier one.

/**
 * Run a game for a class or a section. Resolves with the run.
 * target: { groupKey, section? }  (section null or absent: the whole class)
 */
export async function runGame(sb, { deckId, groupKey, section = null }) {
  const game = await loadHostGame(sb, { deckId });
  if (!game) throw Object.assign(new Error("runGame: no such game"), { code: "missing" });
  const d = game.deck;
  const now = new Date().toISOString();
  const run = mustWrite(await sb.from("decks").insert({
    key: `${d.key}-run-${Date.now().toString(36)}`, title: d.title, group_key: groupKey, section,
    kind: "game", teams: d.teams, time_limit_min: d.time_limit_min, gradebook: d.gradebook,
    source_id: d.source_id || d.id, published: true, opened_at: now, created_at: now,
  }).select(), "runGame/deck")[0];
  await copyQuestions(sb, game, run.id, "runGame");
  return run;
}

// A game's questions and right answers, written onto another deck. Each key
// carries every answer the game counts right: its key, and any answer approved
// when it ran before runs existed (that game keeps those as approvals).
async function copyQuestions(sb, game, deckId, what) {
  for (const c of game.cards) {
    const card = mustWrite(await sb.from("deck_cards").insert({ deck_id: deckId, position: c.position, type: "question", key: c.key, config: c.config }).select(), `${what}/card`)[0];
    const approved = game.accepts.filter(a => a.card_id === c.id && !(a.value && typeof a.value === "object")).map(a => a.value);
    mustWrite(await sb.from("deck_keys").insert({ card_id: card.id, deck_id: deckId, correct: [...(game.keys[c.id] || []), ...approved] }).select(), `${what}/key`);
  }
}

// ─── moving and duplicating ───
//
// A game sits on one class's shelf, and a class's Games page and day plans
// only offer the games on its shelf. A game built for last term's class moves
// to this term's, and its runs come with it: a run hangs off the game, not the
// shelf, and keeps the class it was opened to.

/**
 * Move a game to another class's shelf. Resolves with the game as it is now.
 *
 * A run stays put, and a game with a run still open stays put until the run is
 * closed. A game that ran before runs existed is its own first run, and that
 * run keeps its class: so the questions go to a new game on the new shelf, and
 * the row that ran stays behind as the first run of it, with the later runs.
 */
export async function moveGame(sb, { deckId, groupKey }) {
  const game = await loadHostGame(sb, { deckId });
  if (!game) throw Object.assign(new Error("moveGame: no such game"), { code: "missing" });
  const d = game.deck;
  if (d.source_id) throw Object.assign(new Error("A run stays with the class that played it."), { code: "run" });
  if (d.group_key === groupKey) return d;
  const runs = await listRuns(sb, { deckId });
  if (runs.some(r => r.opened_at && !r.closed_at)) throw Object.assign(new Error("A run of this game is open. Close it first."), { code: "open" });
  if (!d.opened_at) {
    return mustWrite(await sb.from("decks").update({ group_key: groupKey }).eq("id", deckId).select(), "moveGame")[0];
  }
  const moved = mustWrite(await sb.from("decks").insert({
    key: `${groupKey}-game-${Date.now().toString(36)}`, title: d.title, group_key: groupKey,
    kind: "game", published: false, teams: d.teams, time_limit_min: d.time_limit_min, gradebook: d.gradebook,
    created_at: new Date().toISOString(),
  }).select(), "moveGame/game")[0];
  await copyQuestions(sb, game, moved.id, "moveGame");
  must(await sb.from("decks").update({ source_id: moved.id }).eq("source_id", deckId), "moveGame/runs");
  mustWrite(await sb.from("decks").update({ source_id: moved.id }).eq("id", deckId).select(), "moveGame/first");
  return moved;
}

/**
 * A fresh game beside this one: the same questions, right answers and
 * settings, not yet opened, with no runs. On another shelf when groupKey says so.
 */
export async function duplicateGame(sb, { deckId, groupKey = null, title = null }) {
  const game = await loadHostGame(sb, { deckId });
  if (!game) throw Object.assign(new Error("duplicateGame: no such game"), { code: "missing" });
  const d = game.deck;
  const to = groupKey || d.group_key;
  const copy = mustWrite(await sb.from("decks").insert({
    key: `${to}-game-${Date.now().toString(36)}`, title: (title || `${d.title} copy`).trim(), group_key: to,
    kind: "game", published: false, teams: d.teams, time_limit_min: d.time_limit_min, gradebook: d.gradebook,
    created_at: new Date().toISOString(),
  }).select(), "duplicateGame")[0];
  await copyQuestions(sb, game, copy.id, "duplicateGame");
  return copy;
}

/** A game's runs, newest first. A game that ran before runs existed counts as its own first run. */
export async function listRuns(sb, { deckId }) {
  const deck = (must(await sb.from("decks").select("*").eq("id", deckId), "listRuns/deck") || [])[0];
  const runs = must(await sb.from("decks").select("*").eq("source_id", deckId).order("opened_at", { ascending: false }), "listRuns") || [];
  const all = [...runs, ...(deck?.opened_at ? [deck] : [])];
  return all.sort((a, b) => String(b.opened_at || "").localeCompare(String(a.opened_at || "")));
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

/** Deny a typed answer: it and every answer with the same words count as wrong and leave the stream. */
export async function denyAnswer(sb, { deckId, cardId, value }) {
  return mustWrite(await sb.from("deck_accepts").insert({ deck_id: deckId, card_id: cardId, value: { denied: value } }).select(), "denyAnswer")[0];
}

/** Take back an approval or a denial: its answers wait in the stream again. */
export async function undoVerdict(sb, { id }) {
  return mustWrite(await sb.from("deck_accepts").delete().eq("id", id).select(), "undoVerdict");
}

/**
 * Accept an answer in the game a run came from, so every later run of it starts
 * with that answer right. Earlier runs are not touched. Resolves false when the
 * run has no game (a game that ran before runs existed) or the question is gone.
 */
export async function acceptInGame(sb, { runId, cardId, value }) {
  const run = (must(await sb.from("decks").select("id, source_id").eq("id", runId), "acceptInGame/run") || [])[0];
  if (!run?.source_id) return false;
  const card = (must(await sb.from("deck_cards").select("key").eq("id", cardId), "acceptInGame/card") || [])[0];
  if (!card) return false;
  const gameCard = (must(await sb.from("deck_cards").select("id").eq("deck_id", run.source_id).eq("key", card.key).is("retired_at", null), "acceptInGame/gameCard") || [])[0];
  if (!gameCard) return false;
  const key = (must(await sb.from("deck_keys").select("correct").eq("card_id", gameCard.id), "acceptInGame/key") || [])[0];
  const correct = Array.isArray(key?.correct) ? key.correct : [];
  if (correct.some(c => String(c).trim().toLowerCase() === String(value).trim().toLowerCase())) return true;
  mustWrite(await sb.from("deck_keys").upsert({ card_id: gameCard.id, deck_id: run.source_id, correct: [...correct, value] }, { onConflict: "card_id" }).select(), "acceptInGame");
  return true;
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
