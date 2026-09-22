// Games, end to end without a browser: scoring against real spring answers,
// storage against a fake client, and every phone screen rendered.
//
// The numbers asserted here are the numbers on the Game Panel canvas, from the
// spring Week 1 game: 46% on question 4, a class average of 74%, and a spread
// of 2, 2, 3, 8, 6, 3, 4 from the 40s to 100.

import { renderToString } from "react-dom/server";
import QuizDeck, { TeamStart, REVIEW_NOTE } from "../src/games/QuizDeck.jsx";
import GameReview from "../src/games/GameReview.jsx";
import GameDeck from "../src/games/GameDeck.jsx";
import GamePanel from "../src/games/GamePanel.jsx";
import GamesHome from "../src/games/GamesHome.jsx";
import { formFrom, toSave, problems } from "../src/games/GameSetup.jsx";
import { GameStart, GamesNow, AGREEMENT } from "../src/games/GameInvite.jsx";
import { saveGame, denyAnswer, undoVerdict, runGame, listRuns, listGames, acceptInGame } from "../src/games/host.js";
import RunPicker from "../src/games/RunPicker.jsx";
import {
  norm, isRight, scoreGame, previewAccept, groupTyped, isClose,
  timeLeft, secondsLeft, spreadBuckets, approvalStream, recentVerdicts, isDenial,
} from "../src/games/score.js";
import { submitAnswer, startGame, loadGame, createTeam } from "../src/games/store.js";
import { pendingDecks } from "../src/store.js";
import { assertContrast, DEFAULT_THEME, FLOOR } from "../src/tokens.js";
import { fakeSupabase } from "./fake-supabase.js";
import { week1, week7 } from "./fixtures/spring.js";

let failed = 0;
const check = async (label, fn) => {
  try {
    const out = await fn();
    if (out === false) throw new Error("returned false");
    console.log(`  ok    ${label}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${label}\n        ${e.message}`);
  }
};
const eq = (a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  return true;
};

// Week 1 as the database would hold it.
const cards1 = week1.questions.map((q, i) => ({
  id: `w1-${i}`, key: `q${i + 1}`, type: "question", position: i,
  config: { text: q.text, answer: "choice", options: q.options },
}));
const keys1 = Object.fromEntries(week1.questions.map((q, i) => [`w1-${i}`, [q.correct]]));
const responses1 = week1.responses.map(([s, qi, v]) => ({ card_id: `w1-${qi}`, viewer_id: s, answer: { value: v }, review: false }));
const game1 = { cards: cards1, keys: keys1, accepts: [], responses: responses1 };

// Week 7 Trivia's first three questions, typed, answered by teams.
const cards7 = week7.questions.map((q, i) => ({
  id: `w7-${i}`, key: `t${i + 1}`, type: "question", position: i, config: { text: q.text, answer: "typed" },
}));
const keys7 = Object.fromEntries(week7.questions.map((q, i) => [`w7-${i}`, q.accepted]));
const responses7 = week7.answers.map(([team, qi, text]) => ({ card_id: `w7-${qi}`, viewer_id: team, answer: { value: text } }));

async function main() {
  console.log("\ndesign system");
  await check("every text colour clears 4.5:1 on every surface", () => assertContrast());

  console.log("\nscoring, spring Week 1");
  const s = scoreGame(game1);
  await check("28 students answered", () => eq(s.ranking.length, 28));
  await check("percent right per question", () => eq(s.questions.map(q => q.pct), [100, 89, 75, 46, 57, 85, 93, 79, 59, 57]));
  await check("question 4 is tough, question 5 is not", () => s.questions[3].tough && !s.questions[4].tough);
  await check("question 4's answers: 0, 14, 1, 13", () => eq(s.questions[3].counts, [0, 14, 1, 13]));
  await check("class average is 74%", () => eq(s.average, 74));
  await check("a student who answered 9 of 9 right ranks at 100%", () => s.ranking.filter(v => v.pct === 100).length === 4);
  await check("spread of scores", () => eq(spreadBuckets(s.ranking.map(v => v.pct)).map(b => b.count), [2, 2, 3, 8, 6, 3, 4]));

  await check("accepting B on question 4: 46% to 96%, average 74% to 79%, 14 scores up", () =>
    eq(previewAccept(game1, "w1-3", 1), { questionBefore: 46, questionAfter: 96, averageBefore: 74, averageAfter: 79, scoresUp: 14 }));

  await check("Please review is counted per answer picked", () => {
    const flagged = responses1.map(r => (r.card_id === "w1-3" && r.answer.value === 1 && r.viewer_id < "s10") ? { ...r, review: true } : r);
    const q = scoreGame({ ...game1, responses: flagged }).questions[3];
    return q.reviews === q.reviewBy[1] && q.reviews > 0 && q.reviewBy[3] === 0;
  });

  console.log("\ntyped answers, spring Week 7 Trivia");
  await check("case, spaces and punctuation do not count", () => norm("  the STICK. ") === "the stick" && isRight("  the STICK. ", ["The stick"]));
  await check("a choice index compares as its number", () => isRight(3, [3]) && !isRight(2, [3]));
  await check("Sticks is close to The stick; Lacrosse is not", () => isClose("Sticks", "The stick") && !isClose("Lacrosse", "The stick"));

  const s7 = scoreGame({ cards: cards7, keys: keys7, accepts: [], responses: responses7 });
  const lacrosse = groupTyped(s7.questions[1].answers, keys7["w7-1"]);
  await check("Lacrosse: one right, Sticks close, four others", () =>
    eq([lacrosse.right.map(a => a.value), lacrosse.close.map(g => [g.to, g.answers.map(a => a.value)]), lacrosse.other.length],
      [["The stick"], [["The stick", ["Sticks"]]], 4]));
  const foos = groupTyped(s7.questions[2].answers, keys7["w7-2"]);
  await check("foosball: five Foosballs right, the sentence left for a tap", () =>
    foos.right.length === 5 && foos.other.length === 1 && /Fußball/.test(foos.other[0].value));
  await check("libero: nothing right, nothing close", () => {
    const g = groupTyped(s7.questions[0].answers, keys7["w7-0"]);
    return g.right.length === 0 && g.close.length === 0;
  });

  console.log("\napproval stream, spring Week 7 Trivia");
  const at = (n) => `2026-05-07T16:${String(10 + n).padStart(2, "0")}:00Z`;
  const timed7 = responses7.map((r, n) => ({ ...r, answered_at: at(n) }));
  const g7 = { cards: cards7, keys: keys7, accepts: [], responses: timed7 };
  const stream = approvalStream(g7);
  await check("answers that match no right answer wait, oldest first", () =>
    stream.length > 0 && stream.every((e, i) => i === 0 || String(stream[i - 1].firstAt) <= String(e.firstAt)));
  await check("a right answer never waits", () => !stream.some(e => /^(the stick|foosball)$/i.test(e.value)));
  await check("Sticks waits, marked close to The stick", () => stream.find(e => e.value === "Sticks")?.closeTo === "The stick");
  await check("waiting answers stay out of the percentage", () => {
    const q = scoreGame(g7).questions[1];
    return q.answered === 1 && q.right === 1 && q.pct === 100 && q.waiting === 5;
  });
  await check("the same words for the same question are one entry with a count", () => {
    const twice = [...timed7, { card_id: "w7-1", viewer_id: "Another team", answer: { value: "lake  CROSS" }, answered_at: at(40) }];
    const e = approvalStream({ ...g7, responses: twice }).find(x => norm(x.value) === "lake cross");
    return e.count === 2 && e.viewers.length === 2;
  });
  await check("approving takes it out of the stream and counts it right", () => {
    const g = { ...g7, accepts: [{ id: "a1", card_id: "w7-1", value: "Sticks", accepted_at: at(50) }] };
    const q = scoreGame(g).questions[1];
    return !approvalStream(g).some(e => e.value === "Sticks") && q.right === 2 && q.answered === 2;
  });
  await check("denying takes it out of the stream and counts it wrong", () => {
    const g = { ...g7, accepts: [{ id: "d1", card_id: "w7-1", value: { denied: "Lake cross" }, accepted_at: at(51) }] };
    const q = scoreGame(g).questions[1];
    return !approvalStream(g).some(e => e.value === "Lake cross") && q.right === 1 && q.answered === 2;
  });
  await check("a denial never counts as right, however it is written", () =>
    !isRight({ denied: "Lake cross" }, ["The stick"]) && isDenial({ denied: "x" }) && !isDenial("x"));
  await check("decided answers list newest first, and undo brings an answer back", () => {
    const accepts = [{ id: "a1", card_id: "w7-1", value: "Sticks", accepted_at: at(50) }, { id: "d1", card_id: "w7-1", value: { denied: "Lake cross" }, accepted_at: at(51) }];
    const recent = recentVerdicts({ ...g7, accepts });
    const undone = approvalStream({ ...g7, accepts: accepts.filter(a => a.id !== "d1") });
    return eq(recent.map(r => [r.value, r.verdict]), [["Lake cross", "denied"], ["Sticks", "approved"]]) && undone.some(e => e.value === "Lake cross");
  });
  await check("the stream renders on the panel with Approve, Deny and the Names switch", () => {
    const html = renderToString(<GamePanel game={{ deck: { id: "d", title: "Week 7 Trivia", teams: "phone", opened_at: at(0) }, ...g7, progress: [], teams: [], extra: [] }} />);
    return /Approval stream/.test(html) && />Approve</.test(html) && />Deny</.test(html) && /Names/.test(html);
  });
  await check("deny and undo write one row each", async () => {
    const sb = fakeSupabase({ tables: { deck_accepts: [] } });
    const row = await denyAnswer(sb, { deckId: "d", cardId: "w7-1", value: "Lake cross" });
    const denied = sb.tables.deck_accepts.length === 1 && sb.tables.deck_accepts[0].value.denied === "Lake cross";
    await undoVerdict(sb, { id: row.id });
    return denied && sb.tables.deck_accepts.length === 0;
  });

  console.log("\nruns: one game, a run per class or section");
  const runWorld = () => fakeSupabase({ tables: {
    decks: [{ id: "g", key: "comm3-game-1", title: "Week 1", group_key: "comm3", kind: "game", teams: "none", time_limit_min: 15, published: false }],
    deck_cards: [{ id: "c1", deck_id: "g", position: 0, type: "question", key: "q1", config: { text: "Lacrosse?", answer: "typed" } }],
    deck_keys: [{ card_id: "c1", deck_id: "g", correct: ["The stick"] }],
    deck_accepts: [], deck_responses: [], deck_progress: [], deck_teams: [], deck_extra_time: [],
  } });
  await check("Run makes a run for the section, with the game's questions and answers", async () => {
    const sb = runWorld();
    const r = await runGame(sb, { deckId: "g", groupKey: "comm3", section: "8:00" });
    const cards = sb.tables.deck_cards.filter(c => c.deck_id === r.id);
    const key = sb.tables.deck_keys.find(k => k.card_id === cards[0].id);
    return r.source_id === "g" && r.section === "8:00" && r.published && !!r.opened_at && r.time_limit_min === 15
      && cards.length === 1 && cards[0].key === "q1" && eq(key.correct, ["The stick"]);
  });
  await check("running it again for the other section leaves the first run alone", async () => {
    const sb = runWorld();
    const a = await runGame(sb, { deckId: "g", groupKey: "comm3", section: "8:00" });
    sb.tables.deck_responses.push({ deck_id: a.id, card_id: "x", viewer_id: "s1", answer: { value: "Sticks" } });
    const b = await runGame(sb, { deckId: "g", groupKey: "comm3", section: "10:30" });
    const runs = await listRuns(sb, { deckId: "g" });
    return a.id !== b.id && runs.length === 2 && sb.tables.deck_responses.every(x => x.deck_id === a.id);
  });
  await check("the games list shows games, never their runs", async () => {
    const sb = runWorld();
    await runGame(sb, { deckId: "g", groupKey: "comm3", section: "8:00" });
    return eq((await listGames(sb, { groupKey: "comm3" })).map(g => g.id), ["g"]);
  });
  await check("a game that ran before runs existed counts as its own first run", async () => {
    const sb = runWorld();
    sb.tables.decks[0].opened_at = "2026-04-02T17:00:00Z";
    await runGame(sb, { deckId: "g", groupKey: "comm3", section: "8:00" });
    const runs = await listRuns(sb, { deckId: "g" });
    return runs.length === 2 && runs.some(r => r.id === "g");
  });
  await check("a run starts with answers the game approved when it ran before", async () => {
    const sb = runWorld();
    sb.tables.deck_accepts.push({ id: "a1", deck_id: "g", card_id: "c1", value: "Sticks" }, { id: "d1", deck_id: "g", card_id: "c1", value: { denied: "Lake cross" } });
    const r = await runGame(sb, { deckId: "g", groupKey: "comm3" });
    const card = sb.tables.deck_cards.find(c => c.deck_id === r.id);
    return eq(sb.tables.deck_keys.find(k => k.card_id === card.id).correct, ["The stick", "Sticks"]);
  });
  await check("an answer approved in a run is accepted in its game for the next section", async () => {
    const sb = runWorld();
    const r = await runGame(sb, { deckId: "g", groupKey: "comm3", section: "8:00" });
    const card = sb.tables.deck_cards.find(c => c.deck_id === r.id);
    const done = await acceptInGame(sb, { runId: r.id, cardId: card.id, value: "Sticks" });
    return done && eq(sb.tables.deck_keys.find(k => k.card_id === "c1").correct, ["The stick", "Sticks"]);
  });
  await check("the Run picker lists each section and marks one already open", () => {
    const html = renderToString(<RunPicker T={DEFAULT_THEME} inline groups={[{ groupKey: "comm3", section: "8:00", label: "COMM 3 · 8:00" }, { groupKey: "comm3", section: "10:30", label: "COMM 3 · 10:30" }]}
      openFor={[{ groupKey: "comm3", section: "8:00" }]} onRun={() => {}} />);
    return html.includes("COMM 3 · 8:00") && html.includes("COMM 3 · 10:30") && (html.match(/>Open</g) || []).length === 1;
  });

  console.log("\ntime");
  await check("above a minute counts minutes, up", () => eq([timeLeft(252), timeLeft(61), timeLeft(60), timeLeft(45), timeLeft(-3)], ["5 min", "2 min", "60 sec", "45 sec", "0 sec"]));
  await check("no clock without a limit", () => secondsLeft({ startedAt: "2026-09-14T10:00:00Z", limitMin: null }) === null);
  await check("seconds left from the start", () => secondsLeft({ startedAt: "2026-09-14T10:00:00Z", limitMin: 10, now: Date.parse("2026-09-14T10:04:00Z") }) === 360);

  console.log("\nstorage");
  await check("two students submitting the same question at the same moment both land", async () => {
    const sb = fakeSupabase({ unique: { deck_responses: ["card_id", "viewer_id"] } });
    await Promise.all(["s01", "s02", "s03"].map((v, i) =>
      submitAnswer(sb, { deckId: "d", cardId: "c1", viewerId: v, value: i })));
    return eq(sb.tables.deck_responses.map(r => r.viewer_id).sort(), ["s01", "s02", "s03"]);
  });
  await check("a submit is an insert, never an upsert over an earlier answer", async () => {
    const sb = fakeSupabase();
    await submitAnswer(sb, { deckId: "d", cardId: "c1", viewerId: "s01", value: 2, review: true });
    return sb.calls[0].op === "insert" && sb.calls[0].payload.answer.value === 2 && sb.calls[0].payload.review === true;
  });
  await check("answering a question twice is refused with 23505", async () => {
    const sb = fakeSupabase({ unique: { deck_responses: ["card_id", "viewer_id"] } });
    await submitAnswer(sb, { deckId: "d", cardId: "c1", viewerId: "s01", value: 1 });
    try { await submitAnswer(sb, { deckId: "d", cardId: "c1", viewerId: "s01", value: 3 }); return false; }
    catch (e) { return e.code === "23505" && sb.tables.deck_responses[0].answer.value === 1; }
  });
  await check("a submit the database refuses throws instead of vanishing", async () => {
    const sb = fakeSupabase({ writeReturnsNothing: true });
    try { await submitAnswer(sb, { deckId: "d", cardId: "c1", viewerId: "s01", value: 1 }); return false; }
    catch (e) { return e.code === "refused"; }
  });
  await check("starting twice keeps the first start", async () => {
    const sb = fakeSupabase({ tables: { deck_progress: [] } });
    const a = await startGame(sb, { deckId: "d", viewerId: "s01" });
    const b = await startGame(sb, { deckId: "d", viewerId: "s01" });
    return sb.tables.deck_progress.length === 1 && a.started_at === b.started_at;
  });
  await check("loadGame answers as the team the viewer is on, and resumes", async () => {
    const sb = fakeSupabase({ tables: {
      decks: [{ id: "d", title: "Week 7 Trivia", teams: "phone" }],
      deck_cards: cards7.map(c => ({ ...c, deck_id: "d" })),
      deck_teams: [{ id: "team:1", deck_id: "d", name: "Dallas Sharks", members: ["e@scu.edu", "f@scu.edu"] }],
      deck_responses: [{ deck_id: "d", card_id: "w7-0", viewer_id: "team:1", answer: { value: "Work" } }],
      deck_progress: [], deck_extra_time: [],
    } });
    const g = await loadGame(sb, { deckId: "d", viewerId: "f@scu.edu" });
    return g.speaksAs === "team:1" && g.team.name === "Dallas Sharks" && eq(Object.keys(g.answered), ["t1"]);
  });
  await check("createTeam trims the name", async () => {
    const sb = fakeSupabase();
    const t = await createTeam(sb, { deckId: "d", name: "  Dallas Sharks ", members: ["e@scu.edu"] });
    return t.name === "Dallas Sharks";
  });
  await check("a game never blocks the site the way a gate does", async () => {
    const sb = fakeSupabase({ tables: {
      decks: [{ id: "g1", group_key: "g", published: true, kind: "game" }, { id: "d1", group_key: "g", published: true }],
      deck_progress: [],
    } });
    return eq((await pendingDecks(sb, { viewerId: "v", groups: ["g"] })).map(d => d.id), ["d1"]);
  });

  console.log("\nphone screens");
  const smallest = (html) => Math.min(...[...html.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1])));
  const screens = {
    "multiple choice": <QuizDeck title="Week 1" cards={cards1} answered={{ q1: { value: 1 }, q2: { value: 1 } }} startedAt="2026-09-14T10:00:00Z" limitMin={20} now={Date.parse("2026-09-14T10:07:10Z")} />,
    "typed, for a team": <QuizDeck title="Week 7 Trivia" cards={cards7} answered={{ t1: { value: "Work" } }} teamName="Dallas Sharks" />,
    "done": <QuizDeck title="Week 7 Trivia" cards={cards7} answered={{ t1: {}, t2: {}, t3: {} }} teamName="Dallas Sharks" />,
    "out of time": <QuizDeck title="Week 1" cards={cards1} startedAt="2026-09-14T10:00:00Z" limitMin={5} now={Date.parse("2026-09-14T10:06:00Z")} />,
    "team start": <TeamStart title="Week 7 Trivia" viewerId="e@scu.edu" roster={[{ id: "e@scu.edu", name: "E" }, { id: "f@scu.edu", name: "F" }]} />,
    "their answers back": <GameReview title="Week 1" cards={cards1.slice(0, 3)} result={{ right: 2, answered: 3 }}
      mine={{ "w1-0": { value: 1 }, "w1-1": { value: 0, review: true }, "w1-2": { value: 2 } }}
      keys={{ "w1-0": [1], "w1-1": [3], "w1-2": [2] }} onExit={() => {}} />,
  };
  const html = {};
  for (const [name, el] of Object.entries(screens)) {
    await check(`${name} renders`, () => { html[name] = renderToString(el); return html[name].length > 200; });
  }
  await check(`nothing on a phone screen is under ${FLOOR}px`, () => {
    const low = Object.entries(html).map(([n, h]) => [n, smallest(h)]).filter(([, px]) => px < FLOOR);
    if (low.length) throw new Error(JSON.stringify(low));
    return true;
  });
  await check("a question opens on the third question with 13 min left", () =>
    html["multiple choice"].includes(week1.questions[2].text.replace(/"/g, "&quot;")) && /3<!-- --> \/ <!-- -->10/.test(html["multiple choice"]) && html["multiple choice"].includes("13 min"));
  await check("a question has Submit and Please review, and no Back", () =>
    /Submit/.test(html["multiple choice"]) && /Please review/.test(html["multiple choice"]) && !/Back|←/.test(html["multiple choice"]));
  await check("options are lettered A to D", () => ["A", "B", "C", "D"].every(l => html["multiple choice"].includes(`>${l}</span>`)));
  await check("Submit waits for an answer", () => /disabled=""[^>]*>Submit/.test(html["multiple choice"]));
  await check("the team's name rides along", () => html["typed, for a team"].includes("Dallas Sharks"));
  await check("done shows the game and the team, and no score", () =>
    html.done.includes("Week 7 Trivia") && html.done.includes("Dallas Sharks") && !/%/.test(html.done.replace(/width:[^;"]*%/g, "")));
  await check("out of time goes to done", () => !/Submit/.test(html["out of time"]) && html["out of time"].includes("Week 1"));
  await check("GameDeck renders while loading", () => typeof renderToString(
    <GameDeck supabase={fakeSupabase()} deckId="d" viewer={{ id: "s01@scu.edu" }} />) === "string");
  console.log("\ngame panel");
  const hostGame = { deck: { id: "d", title: "Week 1", teams: "none", time_limit_min: 20, opened_at: "2026-09-14T10:00:00Z" },
    cards: cards1, keys: keys1, accepts: [], responses: responses1, progress: [{ viewer_id: "s01", completed_at: null }], teams: [], extra: [] };
  const roster = [...new Set(responses1.map(r => r.viewer_id)), "s29"].map(id => ({ id, name: id }));
  const panels = {
    live: renderToString(<GamePanel context="COMM 118" game={hostGame} roster={roster} now={Date.parse("2026-09-14T10:07:00Z")} />),
    closed: renderToString(<GamePanel game={{ ...hostGame, deck: { ...hostGame.deck, closed_at: "2026-09-14T10:20:00Z" } }} roster={roster} />),
  };
  await check("the live panel shows every question, the ranking and time left", () =>
    /All questions/.test(panels.live) && /Scores/.test(panels.live) && panels.live.includes("13 min") && /46<!-- -->%|46%/.test(panels.live));
  await check("a closed game offers release, take it later and the room screen", () =>
    /Release scores/.test(panels.closed) && /Take it later/.test(panels.closed) && /Put on screen/.test(panels.closed) && !/Answering/.test(panels.closed));
  await check(`nothing on the panel is under ${FLOOR}px`, () => {
    const low = Object.entries(panels).map(([n, h]) => [n, smallest(h)]).filter(([, px]) => px < FLOOR);
    if (low.length) throw new Error(JSON.stringify(low));
    return true;
  });

  await check("the panel calls it Scores, with the average on top", () =>
    /Scores/.test(panels.live) && /Average/.test(panels.live) && !/Ranking/.test(panels.live));
  await check("a draft game offers Open, not Close", () => {
    const draft = renderToString(<GamePanel game={{ ...hostGame, deck: { ...hostGame.deck, opened_at: null } }} roster={roster} on={{ open() {}, edit() {} }} />);
    return />Open</.test(draft) && />Edit</.test(draft) && !/>Close</.test(draft);
  });

  console.log("\nsetting up a game");
  await check("a form round-trips a saved game", () => {
    const f = formFrom({ deck: { title: "Week 1", teams: "none", time_limit_min: 20 }, cards: cards1.slice(0, 2), keys: keys1, teams: [] });
    const out = toSave(f);
    return f.timeOn && f.minutes === 20 && eq(out.questions.map(q => q.correct), [[1], [1]]) && out.settings.time_limit_min === 20;
  });
  await check("an empty option drops out and the right answer follows its option", () => {
    const f = { title: "T", teams: "none", timeOn: false, closesAt: "", gradebook: false, teamRows: [],
      questions: [{ text: "Q", image: "", answer: "choice", options: ["", "One", "Two", ""], correct: [2], accepted: "" }] };
    return eq(toSave(f).questions[0], { id: undefined, text: "Q", image: "", answer: "choice", options: ["One", "Two"], correct: [1] });
  });
  await check("free-form accepted answers split on commas", () => {
    const f = { title: "T", teams: "phone", timeOn: false, closesAt: "", gradebook: false, teamRows: [],
      questions: [{ text: "Q", image: "", answer: "typed", options: [], correct: [], accepted: "Free, liberty ," }] };
    return eq(toSave(f).questions[0].correct, ["Free", "liberty"]);
  });
  await check("a question with no right answer, or no title, stops the save", () => {
    const f = { title: "", questions: [{ text: "Q", answer: "choice", options: ["A", "B"], correct: [] }] };
    return eq(problems(f).map(p => p.what || p.at), ["title", "correct"]);
  });
  await check("saving writes the cards and their keys, and retires a removed question", async () => {
    const sb = fakeSupabase({ tables: { decks: [{ id: "d" }], deck_cards: [{ id: "old", deck_id: "d" }], deck_keys: [] } });
    await saveGame(sb, { deckId: "d", settings: { title: "Week 1" }, existingIds: ["old"],
      questions: [{ text: "Why?", image: "", answer: "choice", options: ["A", "B"], correct: [1] }] });
    const card = sb.tables.deck_cards.find(c => c.type === "question");
    return card.config.options.length === 2 && sb.tables.deck_keys[0].correct[0] === 1 && !!sb.tables.deck_cards.find(c => c.id === "old").retired_at && sb.tables.decks[0].title === "Week 1";
  });

  console.log("\nstudents");
  await check("the card over the site has his words on the box, and Start waits for it", () => {
    const html = renderToString(<GameStart game={{ deck: { id: "d", title: "Week 1", time_limit_min: 20 }, questions: 10 }} onStart={() => {}} />);
    return html.includes(AGREEMENT) && /disabled=""[^>]*>Start/.test(html) && html.includes("10 questions") && html.includes("20 min");
  });
  await check("the done screen shows a released score and a way back", () => {
    const html = renderToString(<QuizDeck title="Week 1" cards={cards1.slice(0, 1)} answered={{ q1: {} }} result={{ right: 7, answered: 10 }} onExit={() => {}} />);
    return /7<!-- --> \/ <!-- -->10/.test(html) && />Done</.test(html);
  });
  await check("the community list offers Start for an open game and the score for a released one", () => {
    const html = renderToString(<GamesNow onStart={() => {}} games={[
      { deck: { id: "a", title: "Week 2" }, questions: 10, open: true },
      { deck: { id: "b", title: "Week 1" }, questions: 10, done: true, score: { right: 8, answered: 10 } },
    ]} />);
    return />Start</.test(html) && /8<!-- --> \/ <!-- -->10/.test(html);
  });
  await check("the ? beside Please review carries his sentence and a way to close it", () => {
    const html = renderToString(<QuizDeck title="Week 1" cards={cards1.slice(0, 1)} onSubmit={async () => {}} />);
    return html.includes("Please review") && html.includes("What Please review does") && !html.includes(REVIEW_NOTE);
  });
  await check("a finished game hands back their own answers, right and wrong", () => {
    const cards = cards1.slice(0, 2);
    const html = renderToString(<GameReview title="Week 1" cards={cards} result={{ right: 1, answered: 2 }}
      mine={{ [cards[0].id]: { value: week1.questions[0].correct }, [cards[1].id]: { value: 0, review: true } }}
      keys={{ [cards[0].id]: [week1.questions[0].correct], [cards[1].id]: [3] }} />);
    return html.includes(cards[0].config.text) && html.includes("Right answer:")
      && /1<!-- --> \/ <!-- -->2/.test(html) && html.includes("You asked for a review");
  });
  await check("with the key still in, the review gives their answers and no verdict", () => {
    const cards = cards1.slice(0, 1);
    const html = renderToString(<GameReview title="Week 1" cards={cards} mine={{ [cards[0].id]: { value: 1 } }} keys={{}} />);
    return html.includes("The right answers are not out yet") && !html.includes("Right answer:");
  });
  await check("a played game is a way back into it once the answers are out", () => {
    const html = renderToString(<GamesNow onStart={() => {}} onReview={() => {}} games={[
      { deck: { id: "b", title: "Week 1" }, questions: 10, done: true, answersOut: true, score: { right: 8, answered: 10 } },
    ]} />);
    return /<button[^>]*>.*Your answers/s.test(html);
  });
  await check("before he releases the answers there is no way in, score or no score", () => {
    const shut = renderToString(<GamesNow onStart={() => {}} onReview={() => {}} games={[
      { deck: { id: "b", title: "Week 1" }, questions: 10, done: true, answersOut: false },
      { deck: { id: "c", title: "Week 2" }, questions: 10, done: true, answersOut: false, score: { right: 8, answered: 10 } },
    ]} />);
    return !/<button/.test(shut) && !shut.includes("Your answers") && /8<!-- --> \/ <!-- -->10/.test(shut);
  });
  await check("GamesHome renders", () => typeof renderToString(<GamesHome supabase={fakeSupabase()} groupKey="comm118" />) === "string");

  await check("the default theme is the design system's", () => DEFAULT_THEME.font.startsWith("'Outfit'") && DEFAULT_THEME.text === "#1c1917");
}

main().then(() => {
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
});
