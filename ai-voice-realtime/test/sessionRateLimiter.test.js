import assert from "node:assert/strict";
import test from "node:test";

import { SessionRateLimiter } from "../src/protocol/sessionRateLimiter.js";

test("admits one boundary-jitter frame burst while preserving one-frame-per-second refill", () => {
  const limiter = new SessionRateLimiter();

  assert.equal(limiter.accept("video_frame", 0).allowed, true);
  assert.equal(limiter.accept("video_frame", 999).allowed, true);
  const rejected = limiter.accept("video_frame", 999);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.retryAfterMs >= 1 && rejected.retryAfterMs <= 2, true);
  assert.equal(limiter.accept("video_frame", 1_999).allowed, true);
});

test("allows one typed question every two seconds", () => {
  const limiter = new SessionRateLimiter();

  assert.equal(limiter.accept("typed_question", 0).allowed, true);
  assert.deepEqual(limiter.accept("typed_question", 1999), {
    allowed: false,
    retryAfterMs: 1,
  });
  assert.equal(limiter.accept("typed_question", 2000).allowed, true);
});

test("does not rate-limit capture or configuration commands", () => {
  const limiter = new SessionRateLimiter();

  for (let index = 0; index < 20; index += 1) {
    assert.equal(limiter.accept("capture_source", 0).allowed, true);
    assert.equal(limiter.accept("session_config", 0).allowed, true);
  }
});

test("keeps microphone and tab audio packet buckets independent", () => {
  const limiter = new SessionRateLimiter();

  for (let index = 0; index < 75; index += 1) {
    assert.equal(limiter.accept("audio_microphone", 0).allowed, true);
  }
  assert.deepEqual(limiter.accept("audio_microphone", 0), {
    allowed: false,
    retryAfterMs: 1_000,
  });

  for (let index = 0; index < 15; index += 1) {
    assert.equal(limiter.accept("audio_tab", 0).allowed, true);
  }
  assert.deepEqual(limiter.accept("audio_tab", 0), {
    allowed: false,
    retryAfterMs: 1_000,
  });
});
