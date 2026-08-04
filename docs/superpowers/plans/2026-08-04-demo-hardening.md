# StreamSense Hackathon Demo Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Chrome-extension demo resilient to hostile or accidental client input, overlapping Gemini turns, capture ownership drift, and backend/extension protocol drift.

**Architecture:** Extract the browser protocol and per-session model lifecycle into testable backend modules. The HTTP entrypoint will create a `noServer` WebSocket endpoint with an explicit Chrome-extension origin policy and 2 MiB payload cap. `ClientSession` will own strict message parsing, per-command rate limits, immutable frame snapshots, and one abortable Gemini turn. Chrome's tab-capture status events will own badge state, while a cross-project type-list test keeps the backend and extension handlers aligned.

**Tech Stack:** Node.js ESM, Express 4, `ws` 8, Zod 4, SQLite via `better-sqlite3`, Gemini `generateContent`, Chrome Manifest V3, React 19, TypeScript 5.9, Node test runner.

## Global Constraints

- Keep the current atomic `generateContent` implementation and `gemini-3.6-flash` default.
- Accept WebSocket upgrades only from `chrome-extension://<32 a-p characters>` origins.
- Limit a WebSocket message to 2 MiB and reject binary client commands.
- Preserve the existing four client commands and narration-level values.
- Allow no more than two frames per second and one question per two seconds per connection.
- Keep at most one live Gemini request per `ClientSession` and pass its `AbortSignal` to `fetch`.
- Preserve the exact analyzed frame's timestamp through event persistence.
- Do not repair the standalone static web client or migrate API surfaces in this change.

## File Structure

- Create `ai-voice-realtime/src/protocol/browserMessages.js`: strict Zod client-command schemas, server-message type contract, payload constants, and parsing.
- Create `ai-voice-realtime/src/protocol/websocketPolicy.js`: extension-origin validation and upgrade rejection.
- Create `ai-voice-realtime/src/protocol/sessionRateLimiter.js`: deterministic per-command rolling-window limiter.
- Create `ai-voice-realtime/src/session/clientSession.js`: extracted browser session and abortable model-turn lifecycle.
- Create `ai-voice-realtime/src/server/createStreamSenseServer.js`: Express, HTTP upgrade, WebSocket, EventStore, listen, and close lifecycle.
- Modify `ai-voice-realtime/server.js`: environment-backed executable entrypoint only.
- Modify `ai-voice-realtime/src/gemini/vision.js`: propagate `AbortSignal` to Gemini fetch.
- Create backend unit and integration tests under `ai-voice-realtime/test/`.
- Create `chrome-extension/src/services/captureBadge.ts`: pure status-to-badge mapping and dependency-injected update helper.
- Modify `chrome-extension/src/services/background.ts`: subscribe to `tabCapture.onStatusChanged`.
- Modify `chrome-extension/src/sidepanel/App.tsx`: remove active-tab badge guessing.
- Modify `chrome-extension/src/sidepanel/realtime/types.ts` and `useRealtimeSession.ts`: declare and handle the backend protocol contract, including telemetry.
- Create extension badge and protocol compatibility tests under `chrome-extension/test/`.
- Modify `ai-voice-realtime/README.md` and `.env.example`: atomic-vision demo setup.

---

### Task 1: Strict browser command parsing and rate limits

**Files:**
- Create: `ai-voice-realtime/src/protocol/browserMessages.js`
- Create: `ai-voice-realtime/src/protocol/sessionRateLimiter.js`
- Test: `ai-voice-realtime/test/browserMessages.test.js`
- Test: `ai-voice-realtime/test/sessionRateLimiter.test.js`

**Interfaces:**
- Export `MAX_WEBSOCKET_PAYLOAD_BYTES = 2 * 1024 * 1024`.
- Export `SERVER_MESSAGE_TYPES` as a frozen array containing every current backend output type.
- Export `parseBrowserMessage(rawText)` returning a discriminated union with `type` equal to `capture_source`, `video_frame`, `session_config`, or `typed_question`.
- Export `SessionRateLimiter` with `accept(type, now = Date.now())` returning `{ allowed: boolean, retryAfterMs: number }`.

- [ ] **Step 1: Write strict-schema tests**

Cover one valid payload for each command and rejection of `null`, arrays, malformed JSON, unknown types, unknown fields, empty questions, questions longer than 500 characters, negative/non-finite timestamps, non-JPEG frames, and empty frame data.

- [ ] **Step 2: Run the focused test and confirm RED**

Run `node --test test/browserMessages.test.js` from `ai-voice-realtime`.

Expected: failure because `src/protocol/browserMessages.js` does not exist.

- [ ] **Step 3: Implement strict Zod discriminated-union parsing**

Use `.strict()` objects and `z.discriminatedUnion("type", ...)`. Preserve narration levels `minimal`, `standard`, `detailed`, and `question_only`. Bound decoded-frame input by limiting the base64 string to `MAX_WEBSOCKET_PAYLOAD_BYTES` characters in addition to the transport-level cap.

- [ ] **Step 4: Write deterministic limiter tests**

Assert that frames at `0` and `499` ms are accepted, a third at `999` ms is rejected, a frame at `1000` ms is accepted, questions at `0` and `1999` ms enforce the two-second interval, and configuration/capture-source commands are not rate-limited.

- [ ] **Step 5: Implement the rolling-window limiter and run tests**

Run:

```bash
node --test test/browserMessages.test.js test/sessionRateLimiter.test.js
```

Expected: both focused suites pass.

- [ ] **Step 6: Commit the protocol domain**

```bash
git add ai-voice-realtime/src/protocol ai-voice-realtime/test/browserMessages.test.js ai-voice-realtime/test/sessionRateLimiter.test.js
git commit -m "fix: validate browser websocket commands"
```

### Task 2: Enforce WebSocket origin and payload policy on a real server

**Files:**
- Create: `ai-voice-realtime/src/protocol/websocketPolicy.js`
- Create: `ai-voice-realtime/src/server/createStreamSenseServer.js`
- Create: `ai-voice-realtime/test/websocketPolicy.test.js`
- Create: `ai-voice-realtime/test/websocketIntegration.test.js`
- Modify: `ai-voice-realtime/server.js`

**Interfaces:**
- Export `isAllowedExtensionOrigin(origin)` and `rejectUpgrade(socket, statusCode, message)`.
- Export `createStreamSenseServer(options)` returning `{ app, httpServer, browserWss, eventStore, listen, close }`.
- `listen({ host, port })` resolves the actual bound address so tests can use port `0`.
- `close()` closes sessions, the WebSocket server, HTTP server, and EventStore idempotently.

- [ ] **Step 1: Write origin-policy tests**

Accept `chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`; reject missing origins, `https://example.com`, extension IDs of the wrong length, invalid characters, paths, queries, fragments, credentials, and explicit ports.

- [ ] **Step 2: Run the origin tests and confirm RED**

Run `node --test test/websocketPolicy.test.js`.

Expected: missing-module failure.

- [ ] **Step 3: Implement exact origin parsing**

Parse with `new URL()`, require protocol `chrome-extension:`, hostname `/^[a-p]{32}$/`, empty username/password/search/hash, root pathname, and no port.

- [ ] **Step 4: Write real WebSocket integration tests**

Start `createStreamSenseServer` with `port: 0`, `databasePath: ":memory:"`, and a test session factory. Assert:

- a missing or untrusted Origin receives an unexpected-response status and no connection;
- a trusted origin connects and can send `capture_source`;
- sending `null` closes that connection with `1008`, then a second trusted connection still succeeds;
- a binary command closes with `1003`;
- a payload larger than 2 MiB closes with `1009` and the process remains alive.

- [ ] **Step 5: Extract the runtime and implement explicit upgrades**

Use `new WebSocketServer({ noServer: true, maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES })`. Handle only pathname `/ws`; validate the origin before `handleUpgrade`. Construct `ClientSession` through an injectable factory so integration tests do not call Gemini. Keep Express static routes unchanged.

Make `server.js` load environment variables, construct the runtime, and print the actual bound port. Preserve `npm start` and `npm run dev` behavior.

- [ ] **Step 6: Run integration and syntax checks**

```bash
node --test test/websocketPolicy.test.js test/websocketIntegration.test.js
node --check server.js
```

Expected: all tests pass and the entrypoint parses.

- [ ] **Step 7: Commit the server boundary**

```bash
git add ai-voice-realtime/server.js ai-voice-realtime/src/server ai-voice-realtime/src/protocol/websocketPolicy.js ai-voice-realtime/test/websocketPolicy.test.js ai-voice-realtime/test/websocketIntegration.test.js
git commit -m "fix: restrict and bound websocket clients"
```

### Task 3: Abort Gemini fetches and bind turns to frame snapshots

**Files:**
- Create: `ai-voice-realtime/src/session/clientSession.js`
- Create: `ai-voice-realtime/test/clientSession.test.js`
- Modify: `ai-voice-realtime/src/gemini/vision.js`
- Modify: `ai-voice-realtime/test/vision.test.js`
- Modify: `ai-voice-realtime/src/server/createStreamSenseServer.js`

**Interfaces:**
- Export `ClientSession` with injected `apiKey`, `model`, `analyzeFrame`, `answerQuestion`, clock, and timeout.
- Each active turn stores `{ id, controller, responseMode, timestampSeconds }`.
- `analyzeVisionFrame` and `answerVisionQuestion` accept `signal`; their shared request passes it to `fetch`.

- [ ] **Step 1: Add an abort-propagation test to `vision.test.js`**

Stub `fetch`, call `analyzeVisionFrame` with an `AbortSignal`, and assert `init.signal` is the same object.

- [ ] **Step 2: Run the focused vision test and confirm RED**

Run `node --test test/vision.test.js`.

Expected: the signal assertion fails.

- [ ] **Step 3: Pass `signal` through both Gemini operations**

Add the optional parameter to both public functions, pass it to `generateJson`, and set it on the fetch options.

- [ ] **Step 4: Write `ClientSession` lifecycle tests**

Use a fake open browser socket, in-memory `EventStore`, and deferred analysis functions. Assert:

- `null` and malformed commands close only the client with `1008`;
- binary input closes with `1003`;
- a replacement question aborts the previous narration signal;
- timeout aborts the active request and emits interrupted completion without `analysis_error`;
- `close()` aborts the active request;
- a genuine provider rejection emits `analysis_error` and permits another turn;
- a narration started at timestamp `12.5` records `12.5` even after a frame at `99` arrives.

- [ ] **Step 5: Extract and implement the session test-first**

Move existing session behavior from `server.js` without changing UI messages. Parse every text message through `parseBrowserMessage`, enforce `SessionRateLimiter`, and close on policy violations. Snapshot the latest frame and timestamp before `beginModelTurn` launches the async call.

`beginModelTurn` must abort and finish the prior active turn before creating a new controller. Timeout and `close()` call a shared abort helper. In catches, treat `controller.signal.aborted` as expected cancellation; send `analysis_error` only for non-abort failures. Event-recording methods receive the turn timestamp explicitly.

- [ ] **Step 6: Run session, vision, and full backend tests**

```bash
node --test test/clientSession.test.js test/vision.test.js
npm test
npm run check
```

Expected: all backend tests and syntax checks pass.

- [ ] **Step 7: Commit model-turn hardening**

```bash
git add ai-voice-realtime/src/session ai-voice-realtime/src/server/createStreamSenseServer.js ai-voice-realtime/src/gemini/vision.js ai-voice-realtime/test/clientSession.test.js ai-voice-realtime/test/vision.test.js
git commit -m "fix: cancel superseded Gemini turns"
```

### Task 4: Make tab-capture status own the badge

**Files:**
- Create: `chrome-extension/src/services/captureBadge.ts`
- Create: `chrome-extension/test/captureBadge.test.ts`
- Modify: `chrome-extension/src/services/background.ts`
- Modify: `chrome-extension/src/sidepanel/App.tsx`

**Interfaces:**
- Export `badgeTextForCaptureStatus(status)` returning `"ON"` only for `active` and `"OFF"` otherwise.
- Export `syncCaptureBadge(info, setBadgeText)` that does nothing without a numeric `tabId` and otherwise updates that exact tab.

- [ ] **Step 1: Write badge ownership tests**

Assert all Chrome capture statuses map correctly, the exact event tab ID is passed to `setBadgeText`, and missing tab IDs are ignored.

- [ ] **Step 2: Run the focused test and confirm RED**

Run `npm test -- --test-name-pattern="capture badge"` from `chrome-extension`.

Expected: missing-module failure.

- [ ] **Step 3: Implement the helper and register the Chrome listener**

In `background.ts`, subscribe to `chrome.tabCapture.onStatusChanged` and call the helper with `chrome.action.setBadgeText`. Keep initial `OFF` behavior. Remove the `ExtensionStatusService.setRunning(session.isRunning)` effect and unused imports from `App.tsx`; React state must no longer select an active tab for badge updates.

- [ ] **Step 4: Run tests and production build**

```bash
npm test
npm run build
```

Expected: extension tests pass and TypeScript/Vite build succeeds.

- [ ] **Step 5: Commit badge ownership**

```bash
git add chrome-extension/src/services/captureBadge.ts chrome-extension/src/services/background.ts chrome-extension/src/sidepanel/App.tsx chrome-extension/test/captureBadge.test.ts
git commit -m "fix: derive badge from tab capture status"
```

### Task 5: Lock the backend/extension message contract

**Files:**
- Modify: `chrome-extension/src/sidepanel/realtime/types.ts`
- Modify: `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts`
- Create: `chrome-extension/test/protocolContract.test.ts`
- Test: `ai-voice-realtime/src/protocol/browserMessages.js`

**Interfaces:**
- Export `SUPPORTED_SERVER_MESSAGE_TYPES` from extension `types.ts`.
- Define `ServerMessage` as a discriminated union covering the backend's current messages while retaining optional payload fields used by legacy UI cases.

- [ ] **Step 1: Write a cross-project contract test**

Import `SERVER_MESSAGE_TYPES` from the backend and `SUPPORTED_SERVER_MESSAGE_TYPES` from the extension. Assert every backend-emitted type is supported. Also assert the four extension command names are accepted by backend parsing fixtures.

- [ ] **Step 2: Run the focused test and confirm RED**

Run `node --experimental-strip-types --test test/protocolContract.test.ts` from `chrome-extension`.

Expected: failure because the extension type list is absent and telemetry is not handled explicitly.

- [ ] **Step 3: Declare the extension contract and handle telemetry**

Add all current backend output types to the frozen list. Add a `case "telemetry"` intentional no-op to the switch so it is reviewable rather than silently falling through. Keep existing legacy narration/audio cases if the current UI still supports them.

- [ ] **Step 4: Run both project suites and build**

```bash
cd chrome-extension
npm test
npm run build

cd ../ai-voice-realtime
npm test
```

Expected: all tests pass and the extension builds.

- [ ] **Step 5: Commit the protocol contract**

```bash
git add chrome-extension/src/sidepanel/realtime/types.ts chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts chrome-extension/test/protocolContract.test.ts
git commit -m "test: lock extension backend protocol"
```

### Task 6: Reconcile demo documentation and complete verification

**Files:**
- Modify: `ai-voice-realtime/README.md`
- Modify: `ai-voice-realtime/.env.example`
- Verify: all files changed by Tasks 1-5

- [ ] **Step 1: Update the environment example**

Replace stale `GEMINI_LIVE_MODEL` guidance with:

```dotenv
GOOGLE_API_KEY=your_gemini_api_key_here
GEMINI_VISION_MODEL=gemini-3.6-flash
HOST=127.0.0.1
PORT=8000
```

- [ ] **Step 2: Rewrite the backend README for the demo path**

Describe atomic sampled-frame analysis, prerequisites, `npm install`, `.env`, `npm start` for stable use, `npm run dev` for auto-reload development, `npm test`, extension `npm install && npm run build`, loading `chrome-extension/dist` unpacked, toolbar authorization, and the side-panel start flow.

- [ ] **Step 3: Run fresh full verification**

```bash
cd ai-voice-realtime
npm test
npm run check

cd ../chrome-extension
npm test
npm run build

cd ..
git diff --check
git status --short
```

Expected: all automated checks pass, no whitespace errors, and only intended tracked changes remain.

- [ ] **Step 4: Review the final diff against acceptance criteria**

Confirm the origin rule, 2 MiB transport cap, strict schemas, rate limits, abort paths, timestamp binding, exact-tab badge behavior, contract test, and documentation are all represented by tests or build checks.

- [ ] **Step 5: Commit documentation and any final test-only corrections**

```bash
git add ai-voice-realtime/README.md ai-voice-realtime/.env.example
git commit -m "docs: update StreamSense demo setup"
```

## Manual Demo Checklist

1. Start the backend with `npm start`; confirm it binds to `127.0.0.1:8000`.
2. Build and reload the unpacked extension.
3. Authorize an ordinary HTTPS tab with the toolbar action and start the side-panel session.
4. Confirm the captured tab shows `ON`; stopping the session or ending the media track returns it to `OFF`.
5. Confirm narration and a typed question both complete.
6. Stop during an in-flight question and confirm no late answer or Gemini error appears.
7. Restart the session and confirm the backend remains usable.
8. Confirm a normal web-page script cannot connect directly to `/ws` because its Origin is rejected.
