// The Formula 5 midseason recap, expressed as a deck.
//
// This is the hard case, and encoding it is what justified two features:
//
//   1. `custom` cards. The ladder flythrough and the team board cannot be
//      expressed as data and never will be. They render a component the host
//      registered by name, and get the viewer's `data` object as props.
//   2. `beats`. Card 4 reveals in two steps behind one button: the stake lands
//      alone, then the score and outcome. Without this the recap loses its
//      best moment, and "reveal in stages" is general enough to be worth having
//      (a quiz card wants exactly the same thing).
//
// Note what is NOT here: the light-to-dark theme flip. That was cut from the
// library as an F5-specific flourish. F5 can do it with its own tokens.
//
// Every card here is `read` or `custom`, because the recap asks nothing of the
// reader. That is the useful proof: an informational deck is just a deck where
// no card has an input, not a separate mode.

export const f5Midseason = {
  key: "f5-midseason-2026",
  title: "First half recap",
  group_key: "f5:all",
  published: false,

  cards: [
    {
      key: "title",
      type: "custom",
      config: { component: "TitleCard", head: "Let's take a look at your first half, {first}." },
    },
    {
      key: "you",
      type: "custom",
      config: {
        component: "Ladder",
        head: "You scored {ppr} points a race, which puts you {rankOrdinal} out of 48.",
      },
    },
    {
      key: "team",
      type: "custom",
      config: {
        component: "TeamReveal",
        head: "As for the team competition, you and {mateFirst} race as {teamName}.",
      },
    },
    {
      key: "round11",
      type: "read",
      config: { head: "You were playing for {stakeWas}." },
      // The click beat. Second beat is revealed by the same next button, and
      // back un-reveals before leaving the card.
      beats: [{ component: "Round11Result", head: "{stakeGot}" }],
      nextLabel: "What happened?",
    },
    {
      key: "swap",
      type: "custom",
      config: { component: "Board", mode: "swap", head: "Five teams go up, and five come down." },
      nextLabel: "See scoring averages",
    },
    {
      key: "averages",
      type: "custom",
      config: {
        component: "Board", mode: "byAvg",
        head: "{fairCount} of the 12 best scoring averages are in the Championship Division.",
      },
      nextLabel: "See the second half",
    },
    {
      key: "breakdown",
      type: "custom",
      config: { component: "Breakdown", head: "Team scores reset, but your points carry." },
    },
    {
      key: "teammate",
      type: "read",
      config: {
        head: "You and {mateFirst} have a choice to make.",
        body: "Individual glory, or a team championship? Or find the gap and go for both.",
      },
    },
    {
      key: "title-race",
      type: "custom",
      config: { component: "Contenders", head: "Right now, {leaderName} is in the driver's seat." },
    },
    {
      key: "good-luck",
      type: "read",
      config: { head: "Good luck.", body: "See you in round 12, {first}." },
    },
  ],
};
