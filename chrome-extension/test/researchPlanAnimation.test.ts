import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Deep Research shows animated, reduced-motion-safe active steps", async () => {
  const source = await readFile(
    new URL("../src/sidepanel/components/QuestionSection.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /aria-current=\{status === "active" \? "step"/);
  assert.match(source, /animate-spin/);
  assert.match(source, /animate-ping/);
  assert.match(source, /motion-reduce:animate-none/);
});
