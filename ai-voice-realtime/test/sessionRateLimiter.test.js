import assert from "node:assert/strict";
import test from "node:test";

import { SessionRateLimiter } from "../src/protocol/sessionRateLimiter.js";

test("allows two frames per rolling second and rejects the third", () => {
  const limiter = new SessionRateLimiter();

  assert.deepEqual(limiter.accept("video_frame", 0), {
    allowed: true,
    retryAfterMs: 0,
  });
  assert.deepEqual(limiter.accept("video_frame", 499), {
    allowed: true,
    retryAfterMs: 0,
  });
  assert.deepEqual(limiter.accept("video_frame", 999), {
    allowed: false,
    retryAfterMs: 1,
  });
  assert.deepEqual(limiter.accept("video_frame", 1000), {
    allowed: true,
    retryAfterMs: 0,
  });
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
