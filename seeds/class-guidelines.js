// The first real deck. Nine cards, every one required, one branch.
//
// The HEADLINES are written the way Andrew writes: plain, direct, headline
// first, no throat-clearing. Those are close to final.
//
// Anything that would be an actual fact about an actual class is a [bracketed
// placeholder]. None of it is invented. Swap them for real text before
// publishing; the brackets are there so an unfilled one is impossible to miss.
//
// Written as data before any component existed, on purpose: encoding a real
// deck is what proves the schema holds. Two things it surfaced, both now in the
// design:
//
//   1. Copy needs interpolation. `{name}` is filled from the `data` object the
//      host passes per viewer. Without this every personalised card would have
//      to be a custom component.
//   2. Branching needs to point at a card KEY, not a position. Positions move.
//      Keys are authored by hand and stable.

export const classGuidelines = {
  key: "class-guidelines-[term]",
  title: "Class guidelines",
  group_key: "class:[course]:[term]",
  published: false,

  cards: [
    {
      key: "welcome",
      type: "read",
      config: {
        head: "Welcome to [course], {name}.",
        body: "A few minutes on how this class works. You'll need to get through this before the site opens up.",
      },
    },
    {
      key: "grading",
      type: "read",
      config: {
        head: "Here's how you'll be graded.",
        body: "[grading breakdown]",
      },
    },
    {
      key: "deadlines",
      type: "read",
      config: {
        head: "These are the deadlines that actually matter.",
        body: "[the deadlines]",
      },
    },
    {
      key: "late-work",
      type: "read",
      config: {
        head: "Here's what happens if you're late.",
        body: "[late policy]",
      },
    },
    {
      key: "ai-policy",
      type: "read",
      config: {
        head: "Here's where I stand on AI.",
        body: "[AI policy]",
      },
    },
    {
      key: "confirm",
      type: "acknowledge",
      config: {
        head: "Confirm you've read the guidelines.",
        label: "I've read all of the above.",
      },
    },
    {
      key: "enrolled",
      type: "pick_one",
      config: {
        head: "Are you enrolled, or auditing?",
        options: [
          { value: "enrolled", label: "Enrolled for credit" },
          { value: "auditing", label: "Auditing" },
        ],
      },
      // Auditing students skip the section pick and go straight to the send-off.
      branches: [{ when: "auditing", goto: "done" }],
    },
    {
      key: "hopes",
      type: "free_text",
      config: {
        head: "What do you want to get out of this class?",
        placeholder: "A sentence is fine.",
        maxLength: 400,
      },
    },
    {
      key: "section",
      type: "pick_one",
      config: {
        head: "Which section are you in?",
        options: [
          { value: "[a]", label: "[section a]" },
          { value: "[b]", label: "[section b]" },
          { value: "[c]", label: "[section c]" },
        ],
      },
      // This answer belongs in an enrolments table, not a blob. Decks stores it
      // either way and also fires onAnswer so the host can mirror it.
      handoff: true,
    },
    {
      key: "done",
      type: "read",
      config: {
        head: "You're set.",
        body: "See you [first class], {name}.",
      },
    },
  ],
};
