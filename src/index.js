// Public surface.

export { default as DeckGate } from "./DeckGate.jsx";
export { default as Deck } from "./Deck.jsx";
export { CARD_TYPES } from "./cards/index.jsx";
export { DEFAULT_THEME, SIZE, FLOOR, TAP, FONT_HREF, assertFloor, assertContrast, contrast } from "./tokens.js";

// Games: a quiz or trivia game is a deck. See GAMES.md.
export { default as QuizDeck, TeamStart, REVIEW_NOTE } from "./games/QuizDeck.jsx";
export { default as GameReview, GameReviewLive } from "./games/GameReview.jsx";
export { default as GameDeck } from "./games/GameDeck.jsx";
export { default as GamePanel, GamePanelLive } from "./games/GamePanel.jsx";
export { runGame, listRuns, statsForRuns, acceptInGame } from "./games/host.js";
export { default as RunPicker } from "./games/RunPicker.jsx";
export { loadHostGame, listGames, listGameStats, denyAnswer, undoVerdict, createGame, saveGame, saveTeams, acceptAnswer, openGame, closeGame, release, grantExtraTime, watchGame } from "./games/host.js";
export { default as GameSetup, formFrom, toSave, problems } from "./games/GameSetup.jsx";
export { default as GamesHome } from "./games/GamesHome.jsx";
export { useOpenGames, GameStart, GamePlay, GamesNow, AGREEMENT } from "./games/GameInvite.jsx";
export {
  TOUGH_BELOW, norm, isRight, scoreGame, previewAccept, isClose, groupTyped, approvalStream, recentVerdicts, isDenial,
  timeLeft, secondsLeft, spreadBuckets,
} from "./games/score.js";
export {
  loadGame, loadReview, startGame, submitAnswer, moveTo, finishGame, createTeam,
} from "./games/store.js";
export {
  liveCards, nextCard, requiresAnswer, isSatisfied,
  resumeAt, isComplete, interpolate,
} from "./resolve.js";
export {
  pendingDecks, loadDeck, saveAnswer, saveProgress, markComplete,
} from "./store.js";
