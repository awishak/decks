// The local preview's pretend class: one fake database, one real spring game,
// and a class that answers it with the answers they actually gave.
//
// The panel page builds this and keeps it on window.previewWorld. The phone,
// in a frame on the same page, reaches up and uses the same world, so an
// answer given on the phone lands in the same rows the panel is watching.

import { fakeSupabase } from "../scripts/fake-supabase.js";
import { week1, week7 } from "../scripts/fixtures/spring.js";
import { startGame, submitAnswer, finishGame, createTeam } from "../src/games/store.js";

// A small seeded random, so the pretend class behaves the same on every reload.
function seeded(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ME = { id: "you@scu.edu", name: "You" };

export function makeWorld(which = "week1") {
  const opened = new Date().toISOString();
  const game = which === "week7"
    ? {
      deck: { id: "week7", title: week7.title, kind: "game", teams: "phone", time_limit_min: null, opened_at: opened, published: true },
      cards: week7.questions.map((q, i) => ({ id: `w7-${i}`, key: `t${i + 1}`, type: "question", position: i, deck_id: "week7", config: { text: q.text, answer: "typed" } })),
      keys: week7.questions.map((q, i) => ({ deck_id: "week7", card_id: `w7-${i}`, correct: q.accepted })),
    }
    : {
      deck: { id: "week1", title: week1.title, kind: "game", teams: "none", time_limit_min: 20, opened_at: opened, published: true },
      cards: week1.questions.map((q, i) => ({ id: `w1-${i}`, key: `q${i + 1}`, type: "question", position: i, deck_id: "week1", config: { text: q.text, answer: "choice", options: q.options } })),
      keys: week1.questions.map((q, i) => ({ deck_id: "week1", card_id: `w1-${i}`, correct: [q.correct] })),
    };

  const sb = fakeSupabase({
    tables: {
      decks: [game.deck], deck_cards: game.cards, deck_keys: game.keys, deck_accepts: [],
      deck_responses: [], deck_progress: [], deck_teams: [], deck_extra_time: [],
    },
    unique: { deck_responses: ["card_id", "viewer_id"], deck_extra_time: ["deck_id", "viewer_id"] },
  });

  const students = [...new Set(week1.responses.map(r => r[0]))];
  const roster = [
    ...students.map((id, i) => ({ id, name: `Student ${i + 1}` })),
    { id: "s29", name: "Student 29" },
    ME,
  ];

  return { which, sb, deckId: game.deck.id, roster, run: (speed = 1) => runClass(sb, game, speed) };
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const closed = (sb, deckId) => !!sb.tables.decks.find(d => d.id === deckId)?.closed_at;

function runClass(sb, game, speed) {
  const rand = seeded(118);
  const deckId = game.deck.id;
  const pace = () => (3000 + rand() * 6000) / speed;

  if (game.deck.teams === "phone") {
    const byTeam = {};
    week7.answers.forEach(([team, qi, text]) => { (byTeam[team] ||= {})[qi] = text; });
    Object.entries(byTeam).forEach(async ([name, answers], n) => {
      await wait((1500 + n * 1200) / speed);
      const team = await createTeam(sb, { deckId, name, members: [`${name}@team`] });
      await startGame(sb, { deckId, viewerId: team.id });
      for (let qi = 0; qi < game.cards.length; qi++) {
        await wait(pace() * 1.5);
        if (closed(sb, deckId)) return;
        if (answers[qi] === undefined) return;   // this team never answered: still answering
        await submitAnswer(sb, { deckId, cardId: game.cards[qi].id, viewerId: team.id, value: answers[qi], review: rand() < 0.15 });
      }
      await finishGame(sb, { deckId, viewerId: team.id });
    });
    return;
  }

  const byStudent = {};
  week1.responses.forEach(([s, qi, v]) => { (byStudent[s] ||= {})[qi] = v; });
  Object.entries(byStudent).forEach(async ([s, answers]) => {
    await wait((rand() * 15000) / speed);
    await startGame(sb, { deckId, viewerId: s });
    for (let qi = 0; qi < game.cards.length; qi++) {
      await wait(pace());
      if (closed(sb, deckId)) return;
      if (answers[qi] === undefined) return;       // skipped in spring: stays "answering"
      const wrong = answers[qi] !== week1.questions[qi].correct;
      const review = rand() < (wrong ? 0.35 : 0.06);
      await submitAnswer(sb, { deckId, cardId: game.cards[qi].id, viewerId: s, value: answers[qi], review });
    }
    await finishGame(sb, { deckId, viewerId: s });
  });
}
