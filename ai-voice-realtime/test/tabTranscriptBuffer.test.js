import assert from "node:assert/strict";
import test from "node:test";

import { TabTranscriptBuffer } from "../src/transcript/tabTranscriptBuffer.js";

const CONTEXT_SOURCE = "captured_tab_audio_transcript";

function makeBuffer(options = {}) {
  let now = 50_000;
  const buffer = new TabTranscriptBuffer({
    nowBackendSessionMs: () => now,
    ...options,
  });

  return {
    buffer,
    setNow(value) {
      now = value;
    },
  };
}

function segment(startMs, endMs, text, languageCode = "en-US") {
  return { startMs, endMs, text, languageCode };
}

test("returns recent final tab speech as explicitly non-user context", () => {
  const { buffer } = makeBuffer();
  buffer.appendFinal({
    startMs: 42_000,
    endMs: 45_000,
    text: "Team A scores — 球进了",
    languageCode: "auto",
  });

  assert.deepEqual(buffer.getRecent(), {
    source: CONTEXT_SOURCE,
    representsUserSpeech: false,
    segments: [
      {
        startMs: 42_000,
        endMs: 45_000,
        text: "Team A scores — 球进了",
        languageCode: "auto",
      },
    ],
  });
});

test("evicts final segments older than two minutes on append and retrieval", () => {
  const { buffer, setNow } = makeBuffer();
  buffer.appendFinal(segment(1_000, 2_000, "expired"));
  buffer.appendFinal(segment(49_000, 50_000, "current"));
  setNow(122_001);

  buffer.appendFinal(segment(121_000, 122_000, "new"));
  assert.deepEqual(buffer.getRecent({ lookbackMs: 120_000 }).segments.map(({ text }) => text), [
    "current",
    "new",
  ]);

  setNow(170_001);
  assert.deepEqual(buffer.getRecent({ lookbackMs: 120_000 }).segments.map(({ text }) => text), [
    "new",
  ]);
  assert.equal(buffer.size, 1);
});

test("bounds stored final text to 12000 Unicode code points without splitting a surrogate pair", () => {
  const { buffer } = makeBuffer();
  const emoji = "😀";
  buffer.appendFinal(segment(1, 2, `${"a".repeat(11_999)}${emoji}`));
  buffer.appendFinal(segment(3, 4, `${emoji}later`));

  const retained = buffer.getRecent({ lookbackMs: 50_000, maxCharacters: 12_000 }).segments;
  assert.equal(retained.reduce((total, item) => total + Array.from(item.text).length, 0), 12_000);
  assert.equal(retained.at(-1).text, `${emoji}later`);
  assert.equal(retained[0].text.endsWith(emoji), true);
  assert.equal(retained[0].text.includes("\uFFFD"), false);
});

test("applies the retrieval character cap without mutating stored final segments", () => {
  const { buffer } = makeBuffer();
  buffer.appendFinal(segment(1, 2, "first"));
  buffer.appendFinal(segment(3, 4, "😀second"));

  const small = buffer.getRecent({ lookbackMs: 50_000, maxCharacters: 7 });
  assert.deepEqual(small.segments, [segment(3, 4, "😀second")]);
  assert.equal(Array.from(small.segments[0].text).length, 7);

  assert.deepEqual(
    buffer.getRecent({ lookbackMs: 50_000, maxCharacters: 50 }).segments,
    [segment(1, 2, "first"), segment(3, 4, "😀second")],
  );
});

test("normalizes whitespace while preserving Unicode final text", () => {
  const { buffer } = makeBuffer();
  buffer.appendFinal(segment(49_000, 49_001, "  球进了\n\t😀  "));

  assert.equal(buffer.getRecent().segments[0].text, "球进了 😀");
});

test("rejects missing, non-finite, backwards clocks and invalid final segments", () => {
  assert.throws(() => new TabTranscriptBuffer(), /nowBackendSessionMs/i);
  assert.throws(() => new TabTranscriptBuffer({ nowBackendSessionMs: () => Number.NaN }), /finite/i);

  const { buffer, setNow } = makeBuffer();
  for (const invalid of [
    segment(-1, 1, "bad"),
    segment(2, 1, "bad"),
    segment(Number.NaN, 1, "bad"),
    segment(1, Infinity, "bad"),
    segment(1, 2, " \n\t "),
    segment(1, 2, "valid", "en US"),
    segment(1, 2, "valid", "\u0000"),
  ]) {
    assert.throws(() => buffer.appendFinal(invalid), TypeError);
  }
  assert.equal(buffer.size, 0);

  buffer.getRecent();
  setNow(49_999);
  assert.throws(() => buffer.getRecent(), /monotonic/i);
});

test("deduplicates only identical normalized final text with overlapping time ranges", () => {
  const { buffer } = makeBuffer();
  buffer.appendFinal(segment(41_000, 42_000, "  goal! "));
  buffer.appendFinal(segment(41_500, 42_500, "goal!"));
  buffer.appendFinal(segment(42_501, 43_000, "goal!"));
  buffer.appendFinal(segment(43_100, 43_200, "different"));

  assert.deepEqual(
    buffer.getRecent().segments,
    [
      segment(41_000, 42_000, "goal!"),
      segment(42_501, 43_000, "goal!"),
      segment(43_100, 43_200, "different"),
    ],
  );
});

test("returns chronologically ordered copies and clear deterministically empties the buffer", () => {
  const { buffer } = makeBuffer();
  const original = segment(49_020, 49_030, "later");
  buffer.appendFinal(original);
  buffer.appendFinal(segment(49_010, 49_015, "earlier"));
  original.text = "caller mutation";

  const context = buffer.getRecent();
  assert.deepEqual(context.segments, [segment(49_010, 49_015, "earlier"), segment(49_020, 49_030, "later")]);
  context.segments[0].text = "result mutation";
  assert.equal(buffer.getRecent().segments[0].text, "earlier");

  buffer.clear();
  assert.equal(buffer.size, 0);
  assert.deepEqual(buffer.getRecent(), {
    source: CONTEXT_SOURCE,
    representsUserSpeech: false,
    segments: [],
  });
});
