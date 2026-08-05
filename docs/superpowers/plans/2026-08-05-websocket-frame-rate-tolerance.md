# WebSocket Frame-Rate Tolerance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent healthy one-frame-per-second StreamSense sessions from closing because of boundary jitter while retaining sustained-rate protection and exposing WebSocket close details.

**Architecture:** Replace only the `video_frame` rolling-window admission rule with a token bucket that refills at one frame per second and holds two tokens; all other rate limits remain rolling-window fail-closed rules. Keep the WebSocket protocol unchanged, and derive user-facing close text from the browser `CloseEvent` through a small pure formatter.

**Tech Stack:** Node.js ESM, `node:test`, TypeScript, React, browser WebSocket API, npm.

## Global Constraints

- Sustained video admission remains one frame per second.
- Video burst capacity is exactly two frames.
- Sustained over-rate video input still closes with WebSocket code 1008.
- Non-frame command and audio limits retain their current behavior.
- Close feedback exposes only the WebSocket code and peer-provided reason.
- Do not modify or stage the existing uncommitted Gemini Live transcript or model-audio playback files.

---

### Task 1: Add bounded frame burst tolerance

**Files:**
- Modify: `ai-voice-realtime/src/protocol/sessionRateLimiter.js`
- Create: `ai-voice-realtime/test/sessionRateLimiter.test.js`
- Modify: `ai-voice-realtime/test/clientSession.test.js:982-1002`

**Interfaces:**
- Consumes: `SessionRateLimiter.accept(type, now)` returning `{ allowed, retryAfterMs }`.
- Produces: the same public return shape; `video_frame` uses a two-token bucket refilled at `1 / 1000` token per millisecond.

- [ ] **Step 1: Write failing token-bucket tests**

Create `ai-voice-realtime/test/sessionRateLimiter.test.js`:

```js
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

test("keeps non-frame commands on their rolling-window limits", () => {
  const limiter = new SessionRateLimiter();

  assert.equal(limiter.accept("typed_question", 0).allowed, true);
  assert.deepEqual(limiter.accept("typed_question", 1), {
    allowed: false,
    retryAfterMs: 1_999,
  });
});
```

The first test catches removal of burst capacity or an incorrect refill rate. The second catches accidentally migrating unrelated limits.

- [ ] **Step 2: Make the integration test exercise the real rate-limit path**

Replace the existing frame-rate test with a valid hello and controlled arrival times:

```js
test("tolerates one boundary frame burst but closes sustained frame flooding", async (t) => {
  let now = 0;
  const fixture = createFixture({ now: () => now });
  t.after(() => fixture.eventStore.close());
  await fixture.session.start();
  hello(fixture, "absent");

  emitVideoFrame(fixture, 0, "first");
  now = 999;
  emitVideoFrame(fixture, 0.999, "boundary-jitter");
  assert.deepEqual(fixture.browser.closed, []);

  emitVideoFrame(fixture, 1, "sustained-flood");
  assert.deepEqual(fixture.browser.closed, [{
    code: 1008,
    reason: "Rate limit exceeded.",
  }]);
});
```

This corrects the old test, which sent frames before `session_hello` and therefore could pass without reaching the rate limiter.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
cd ai-voice-realtime
node --test test/sessionRateLimiter.test.js test/clientSession.test.js
```

Expected: the boundary-jitter assertions fail because the second frame is currently rejected by the rolling-window limiter.

- [ ] **Step 4: Implement the minimal token bucket**

In `sessionRateLimiter.js`, add `burst: 2` only to `video_frame`, store per-type bucket state in a second map, and route only burst-configured limits through this helper:

```js
#acceptTokenBucket(type, limit, now) {
  const previous = this.buckets.get(type) ?? {
    tokens: limit.burst,
    updatedAt: now,
  };
  const elapsedMs = Math.max(0, now - previous.updatedAt);
  const refillPerMs = limit.count / limit.windowMs;
  const tokens = Math.min(
    limit.burst,
    previous.tokens + elapsedMs * refillPerMs,
  );
  if (tokens < 1) {
    this.buckets.set(type, { tokens, updatedAt: now });
    return {
      allowed: false,
      retryAfterMs: Math.max(1, Math.ceil((1 - tokens) / refillPerMs)),
    };
  }
  this.buckets.set(type, { tokens: tokens - 1, updatedAt: now });
  return { allowed: true, retryAfterMs: 0 };
}
```

Initialize `this.buckets = new Map()`, call the helper before rolling-window logic when `limit.burst` is present, and clear both maps in `reset()`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
cd ai-voice-realtime
node --test test/sessionRateLimiter.test.js test/clientSession.test.js
```

Expected: all selected backend tests pass with zero failures.

- [ ] **Step 6: Commit Task 1 without staging user-owned changes**

```bash
git add ai-voice-realtime/src/protocol/sessionRateLimiter.js \
  ai-voice-realtime/test/sessionRateLimiter.test.js \
  ai-voice-realtime/test/clientSession.test.js
git commit -m "fix: tolerate frame timing jitter"
```

---

### Task 2: Surface WebSocket close details

**Files:**
- Modify: `chrome-extension/src/sidepanel/realtime/types.ts`
- Modify: `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts:727-733`
- Modify: `chrome-extension/test/protocolContract.test.ts`

**Interfaces:**
- Produces: `backendConnectionClosedStatus(code: number, reason: string): string`.
- Consumes: `CloseEvent.code` and `CloseEvent.reason` in the realtime session close listener.

- [ ] **Step 1: Write failing formatter tests**

Import `backendConnectionClosedStatus` in `protocolContract.test.ts` and add:

```ts
test("reports backend WebSocket close details with a safe generic fallback", () => {
  assert.equal(
    backendConnectionClosedStatus(1008, "Rate limit exceeded."),
    "Backend connection closed (1008: Rate limit exceeded.)",
  );
  assert.equal(
    backendConnectionClosedStatus(1006, ""),
    "Backend connection closed (1006)",
  );
  assert.equal(
    backendConnectionClosedStatus(1000, ""),
    "Backend connection closed.",
  );
});
```

This catches a missing reason, missing abnormal code, and loss of the generic normal-close fallback.

- [ ] **Step 2: Run the focused extension test and verify RED**

Run:

```bash
cd chrome-extension
node --experimental-strip-types --test test/protocolContract.test.ts
```

Expected: module import failure because `backendConnectionClosedStatus` does not exist.

- [ ] **Step 3: Implement the pure formatter**

Add to `types.ts`:

```ts
export function backendConnectionClosedStatus(code: number, reason: string): string {
  const normalizedReason = reason.trim();
  if (code === 1000 && normalizedReason.length === 0) {
    return "Backend connection closed.";
  }
  const details = normalizedReason.length > 0
    ? `${code}: ${normalizedReason}`
    : String(code);
  return `Backend connection closed (${details})`;
}
```

Import it into `useRealtimeSession.ts`, accept the close event, and replace the hard-coded status:

```ts
websocket.addEventListener("close", (event) => {
  protocol.close();
  if (!isCurrent()) return;
  releaseResources();
  setStatus("error");
  setStatusText(backendConnectionClosedStatus(event.code, event.reason));
});
```

- [ ] **Step 4: Run focused extension tests and verify GREEN**

Run:

```bash
cd chrome-extension
node --experimental-strip-types --test test/protocolContract.test.ts
```

Expected: all protocol-contract tests pass with zero failures.

- [ ] **Step 5: Commit Task 2 without staging user-owned changes**

```bash
git add chrome-extension/src/sidepanel/realtime/types.ts \
  chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts \
  chrome-extension/test/protocolContract.test.ts
git commit -m "fix: show backend close reason"
```

---

### Task 3: Full verification and change-boundary audit

**Files:**
- Verify only; no planned modifications.

**Interfaces:**
- Consumes: completed backend limiter and extension formatter tasks.
- Produces: fresh automated evidence and a clean scope audit for handoff.

- [ ] **Step 1: Run the full backend check**

```bash
cd ai-voice-realtime
npm run check
```

Expected: syntax check and all backend tests pass with zero failures.

- [ ] **Step 2: Run the full extension test suite**

```bash
cd chrome-extension
npm test
```

Expected: all extension tests pass with zero failures.

- [ ] **Step 3: Build the production extension**

```bash
cd chrome-extension
npm run build
```

Expected: TypeScript and Vite complete with exit code 0.

- [ ] **Step 4: Audit the final diff and worktree boundary**

```bash
git status --short
git diff HEAD~2 -- \
  ai-voice-realtime/src/protocol/sessionRateLimiter.js \
  ai-voice-realtime/test/sessionRateLimiter.test.js \
  ai-voice-realtime/test/clientSession.test.js \
  chrome-extension/src/sidepanel/realtime/types.ts \
  chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts \
  chrome-extension/test/protocolContract.test.ts
```

Expected: the implementation contains only the planned limiter, regression-test, and close-feedback changes; the pre-existing six modified Live/audio files remain unstaged and uncommitted.
