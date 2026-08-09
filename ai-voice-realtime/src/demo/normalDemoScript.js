export const NORMAL_DEMO_RESPONSES = Object.freeze({
  whatsHappening:
    "You're watching highlights from the FIFA World Cup between France and England. England just scored and is up 1 to 0.",
  howTheyScored:
    "A loose French pass in midfield is cut out by England’s number four. He carries the ball straight through the middle, reaches the edge of the box, and drills a low finish into the bottom corner.",
});

function normalizeDemoQuestion(value) {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalDemoAnswerForQuestion(question) {
  switch (normalizeDemoQuestion(question)) {
    case "whats happening right now":
    case "what is happening right now":
      return NORMAL_DEMO_RESPONSES.whatsHappening;
    case "how did they score":
      return NORMAL_DEMO_RESPONSES.howTheyScored;
    default:
      return null;
  }
}

export const NORMAL_DEMO_LIVE_INSTRUCTION = [
  "Temporary StreamSense Normal-mode demo script:",
  `- If the user asks “What’s happening right now?”, respond with exactly: ${NORMAL_DEMO_RESPONSES.whatsHappening}`,
  `- If the user asks “How did they score?”, respond with exactly: ${NORMAL_DEMO_RESPONSES.howTheyScored}`,
  "Treat harmless differences in capitalization, punctuation, apostrophes, and contractions as the same question. Do not add or remove any words from these two scripted answers.",
].join("\n");
