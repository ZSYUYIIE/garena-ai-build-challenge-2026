# Live Model Connection Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the browser connection diagnostic identify the configured Gemini Live model instead of the separate vision model.

**Architecture:** Keep the protocol schema and side-panel rendering unchanged. Protect the intended session-boundary behavior with a regression test, then change the existing `connected.model` value at the backend handshake boundary.

**Tech Stack:** Node.js, `node:test`, JavaScript, WebSocket protocol v2, TypeScript/Vite extension build

## Global Constraints

- Preserve the existing `connected` message schema and UI behavior.
- `connected` continues to represent the browser WebSocket and protocol handshake, not Gemini provider readiness.
- Provider readiness remains reported by the existing `provider_health` message.
- Do not change extension-origin policy, Google Cloud credentials, VAD, or physical Chrome acceptance behavior.

---

### Task 1: Correct the connection model diagnostic

**Files:**
- Modify: `ai-voice-realtime/test/clientSession.test.js`
- Modify: `ai-voice-realtime/src/session/clientSession.js:175`

**Interfaces:**
- Consumes: `ClientSession` constructor options `model: string` and `liveModel: string`; browser `session_hello` protocol message.
- Produces: Existing server message `{ type: "connected", protocolVersion: 2, model: string }`, with `model` equal to the configured Live model.

- [ ] **Step 1: Write the failing regression test**

Allow `createFixture()` to accept explicit `model` and `liveModel` values, pass them through to `ClientSession`, and update the handshake test to configure distinct literal names:

```js
const fixture = createFixture({
  model: "vision-model",
  liveModel: "live-model",
  liveSessionFactory: () => new FakeLiveSession(),
});

assert.deepEqual(fixture.browser.messages[0], {
  type: "connected",
  protocolVersion: 2,
  model: "live-model",
});
```

The production mutation this test catches is populating `connected.model` from the vision-model option rather than the Live-model option.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd ai-voice-realtime
node --test --test-name-pattern="acknowledges protocol v2" test/clientSession.test.js
```

Expected: FAIL because the actual model is `vision-model` while the expected model is `live-model`.

- [ ] **Step 3: Apply the minimal production correction**

Change the handshake message in `ClientSession.acceptHello()`:

```js
this.sendBrowser({ type: "connected", protocolVersion: PROTOCOL_VERSION, model: this.liveModel });
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
cd ai-voice-realtime
node --test --test-name-pattern="acknowledges protocol v2" test/clientSession.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 5: Run repository verification**

Run:

```bash
cd ai-voice-realtime && npm run check
cd chrome-extension && npm test
cd chrome-extension && npm run build
```

Expected: all commands exit zero with no test failures or build errors.

- [ ] **Step 6: Commit the implementation**

```bash
git add ai-voice-realtime/test/clientSession.test.js ai-voice-realtime/src/session/clientSession.js docs/superpowers/plans/2026-08-05-live-model-connection-label.md
git commit -m "fix: report live model in connection diagnostic"
```

### Task 2: Independent review and test verification

**Files:**
- Read: `docs/superpowers/specs/2026-08-05-live-model-connection-label-design.md`
- Read: `docs/superpowers/plans/2026-08-05-live-model-connection-label.md`
- Read: Git diff for the implementation commit

**Interfaces:**
- Consumes: The committed implementation and its regression test.
- Produces: A read-only code-review verdict and an independent test report.

- [ ] **Step 1: Dispatch two read-only agents in parallel**

Agent A reviews the implementation against the design and plan, categorizes findings by severity, and gives a merge-readiness verdict. Agent B independently runs the focused regression, backend checks, extension tests, and extension build, then reports exact commands, exit status, and counts. Neither agent may modify the checkout, index, HEAD, or branch.

- [ ] **Step 2: Reconcile agent findings**

Inspect the committed diff and independently rerun any command required to validate or resolve a reported issue. Fix all Critical and Important findings with a new TDD cycle before completion.

- [ ] **Step 3: Run final fresh verification**

After all review findings are resolved, rerun the complete commands from Task 1 Step 5 and report only the freshly observed results.
