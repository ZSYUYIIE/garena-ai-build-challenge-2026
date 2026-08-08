import assert from "node:assert/strict";
import test from "node:test";

import { parseResearchAnswer } from "../src/sidepanel/realtime/researchAnswer.ts";

test("separates polished research content from its linked source list", () => {
  const parsed = parseResearchAnswer(
    "Josh Castellano is a competitive Scrabble player [1].\n\nHe won the 2024 CSW championship [2].\n\n" +
    "## Sources\n\n1. [NASPA player profile](https://example.com/player)\n2. [NASPAWiki](https://example.com/wiki)",
  );

  assert.deepEqual(parsed.paragraphs, [
    "Josh Castellano is a competitive Scrabble player [1].",
    "He won the 2024 CSW championship [2].",
  ]);
  assert.deepEqual(parsed.sources, [
    { index: 1, title: "NASPA player profile", url: "https://example.com/player" },
    { index: 2, title: "NASPAWiki", url: "https://example.com/wiki" },
  ]);
});

test("keeps ordinary Normal-mode responses as readable paragraphs", () => {
  assert.deepEqual(parseResearchAnswer("The score is tied.\n\nIt is the final round."), {
    paragraphs: ["The score is tied.", "It is the final round."],
    sources: [],
  });
});
