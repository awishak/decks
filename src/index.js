// Public surface.

export { default as DeckGate } from "./DeckGate.jsx";
export { default as Deck } from "./Deck.jsx";
export { CARD_TYPES } from "./cards/index.jsx";
export { DEFAULT_THEME, SIZE, FLOOR, TAP, FONT_HREF, assertFloor, assertContrast, contrast } from "./tokens.js";

// Games: a quiz or trivia game is a deck. See GAMES.md.
export { default as QuizDeck, TeamStart } from "./games/QuizDeck.jsx";
export { default as GameDeck } from "./games/GameDeck.jsx";
export {
  TOUGH_BELOW, norm, isRight, scoreGame, previewAccept, isClose, groupTyped,
  timeLeft, secondsLeft, spreadBuckets,
} from "./games/score.js";
export {
  loadGame, startGame, submitAnswer, moveTo, finishGame, createTeam,
} from "./games/store.js";
export {
  liveCards, nextCard, requiresAnswer, isSatisfied,
  resumeAt, isComplete, interpolate,
} from "./resolve.js";
export {
  pendingDecks, loadDeck, saveAnswer, saveProgress, markComplete,
} from "./store.js";
