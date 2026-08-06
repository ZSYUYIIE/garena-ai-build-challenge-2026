# StreamSense Hackathon Demo Hardening Design

## Context

StreamSense is demonstrated through the Chrome extension. The extension captures a tab, sends sampled JPEG frames and questions to a local WebSocket backend, and the backend uses Gemini to generate narration, answers, and timestamped events.

The existing happy path works, but the browser/backend boundary and model-turn lifecycle are too permissive for a reliable live demo. Valid JSON such as `null` can terminate the backend, arbitrary web origins can connect, WebSocket messages inherit the library's large default payload limit, overlapping Gemini requests continue after a newer turn replaces them, and a completed response can be recorded against a later frame timestamp. The extension badge can also report a tab other than the one actually captured.

## Goals

- Keep the Chrome-extension demo usable after malformed, oversized, or overly frequent client input.
- Restrict the local WebSocket endpoint to Chrome extension origins.
- Make every Gemini turn cancellable and bind its stored output to an immutable frame snapshot.
- Make Chrome tab-capture status the source of truth for badge state.
- Add focused unit, integration, and protocol compatibility coverage.
- Reconcile setup documentation with the atomic-vision architecture used by the active branch.

## Non-goals

- Migrating from `generateContent` to the Gemini Interactions API.
- Reintroducing the older Gemini Live/WebRTC architecture.
- Repairing the standalone static web client.
- Redesigning event deduplication or database retention.
- Removing all build warnings or auditing every extension dependency.
- Broadly changing Chrome extension permissions.

## Architecture

The demo keeps its existing topology:

```text
Chrome extension -> loopback WebSocket -> atomic Gemini generateContent -> extension UI
```

Hardening is divided into four boundaries.

### 1. WebSocket boundary

The HTTP server will handle WebSocket upgrades explicitly. It will accept only requests to `/ws` whose `Origin` is a syntactically valid `chrome-extension://<extension-id>` origin. Missing origins and ordinary web origins are rejected before a socket is established.

The WebSocket server will set a 2 MiB maximum message payload. Binary messages are unsupported. Text messages must parse as JSON and match exactly one strict Zod schema:

- `capture_source`: `{ type, source }`, where `source` is `camera` or `screen`.
- `video_frame`: `{ type, timestampSeconds, mimeType, data }`, with a finite non-negative timestamp, JPEG MIME type, and a bounded non-empty base64 payload.
- `session_config`: `{ type, narrationLevel }`, where the level is `minimal`, `standard`, `detailed`, or `question_only`.
- `typed_question`: `{ type, text }`, with trimmed non-empty text no longer than 500 characters.

Unknown keys, unknown message types, malformed JSON, JSON primitives such as `null`, and invalid field types are protocol violations. The server closes only the offending connection with an appropriate WebSocket close code; it must not terminate the process.

Each connection also enforces demo-safe input rates: at most two video frames per rolling second and at most one typed question per two seconds. A violation closes that connection with a policy-violation code. These limits are intentionally above the extension's normal sampling rate while preventing accidental request floods.

### 2. Gemini turn lifecycle

Each browser session owns at most one active model turn. A turn captures an immutable object containing the frame bytes and `timestampSeconds` before the asynchronous request begins.

Starting a newer narration or answer aborts the previous turn. User stop, WebSocket disconnect, session replacement, and request timeout also abort the current `AbortController`. The abort signal is passed through the vision helper to `fetch`.

Expected cancellation is a lifecycle outcome, not a provider failure. The backend emits `turn_complete` with `interrupted: true` when the cancelled turn is still relevant to the client, and it does not emit a user-visible Gemini error. Genuine provider, HTTP, JSON, or schema failures emit `analysis_error`; the WebSocket session remains available for a subsequent turn.

Persisted narration and event records use the immutable snapshot timestamp, never the mutable latest-frame timestamp.

### 3. Chrome capture ownership

The background service worker listens to `chrome.tabCapture.onStatusChanged`. The event's exact `tabId` drives badge updates:

- `active` sets that tab's badge to `ON`.
- `stopped`, `error`, or any non-active status sets that tab's badge to `OFF`.

React session state no longer guesses which active tab owns the badge. Existing toolbar authorization and per-window capture-target behavior remain unchanged.

### 4. Contract and demo setup

The backend exposes its current server-message type list as a small protocol contract. The extension declares the current message types it handles, including telemetry as an intentional no-op. A compatibility test prevents the backend from adding a message type that the extension silently forgets to handle.

The backend integration suite starts a real ephemeral server and verifies:

- `null` input closes one connection without stopping the server.
- untrusted and missing origins fail the HTTP upgrade.
- an oversized message is rejected.
- a valid extension-origin client can send a supported command.

The README and environment example describe the atomic-vision flow, the `GEMINI_VISION_MODEL` setting, extension build/load steps, and `npm start` as the normal stable backend command.

## Error Handling

WebSocket policy failures are isolated to one client. Invalid text input uses close code `1008`; binary input uses `1003`; messages larger than 2 MiB use the WebSocket library's `1009` handling. Upgrade rejection returns an HTTP error without creating a WebSocket.

Rate-limit state and request controllers are per connection and are discarded on close. Cleanup is idempotent so stop and socket-close races cannot create secondary failures.

Provider cancellation is detected from the abort signal/controller state rather than fragile error-message matching. Other errors are normalized for the existing `analysis_error` protocol message and logged without exposing secrets.

## Testing Strategy

Implementation is test-driven and uses the repositories' existing Node test runners.

Backend unit coverage will verify strict schemas, origin policy, rate windows, abort propagation, replacement cancellation, close cancellation, and snapshot timestamps. Backend WebSocket integration tests will exercise the real upgrade and payload boundary. Extension unit coverage will verify badge mapping and exact-tab targeting. A cross-project protocol test will compare backend-emitted types with extension-supported types.

Final automated verification:

```bash
cd ai-voice-realtime
npm test
npm run check

cd ../chrome-extension
npm test
npm run build
```

Manual Chrome acceptance checks will confirm authorization, capture start/stop, badge transitions, narration, questions, recovery after a rejected connection, and backend reconnection.

## Acceptance Criteria

- Malformed JSON, valid non-object JSON, unknown commands, binary input, rate violations, and oversized messages cannot crash the backend.
- Only valid Chrome extension origins can establish `/ws` connections.
- A session never has more than one live Gemini request after replacement or shutdown cleanup.
- Stored output retains the timestamp of the frame analyzed by that request.
- Cancellation does not surface as a Gemini failure; real failures remain recoverable.
- The badge reflects the exact tab-capture status event.
- Backend protocol changes cannot silently drift past the extension handler.
- Backend tests/checks and extension tests/production build pass.
- Demo documentation matches the active atomic-vision implementation.
