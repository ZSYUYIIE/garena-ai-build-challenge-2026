# StreamSense Agent Guide

This file is the operational guide for agents and contributors working in this
repository. Read [architecture.md](architecture.md) before changing a runtime
boundary. The architecture document explains the system; this file explains
how to work on it safely.

## Start here

The repository root is an npm workspace for three cooperating packages:

```text
chrome-extension/   Live Manifest V3 React/TypeScript side panel
ai-voice-realtime/  Shared Express/WebSocket/REST backend and provider adapters
session-dashboard/  History React application served under /dashboard/
```

Use the root lockfile and root scripts for normal setup, development, builds,
demos, and full checks. Package-scoped commands remain useful for focused
iteration, but do not start a second backend beside a root dev profile.

Before making any claim or edit, run:

```bash
git status --short --branch
git branch --show-current
git rev-parse --short HEAD
```

The repository may contain another checkout under
`.worktrees/gemini-live-voice-context`. Do not infer the active branch, source,
test status, or acceptance status from that worktree. Always inspect the files
and Git state in the checkout you were asked to change.

Treat all pre-existing changes as user-owned. Do not discard, rewrite, stage,
or commit them unless explicitly asked. Documentation and historical plans do
not establish the current branch or verification state; inspect Git and run
the relevant gates in the active checkout.

## Product intent

StreamSense is one local product with a Live Chrome side panel, a History
dashboard, and one shared backend. It:

- captures one explicitly authorized HTTP(S) tab;
- samples meaningful visual changes as bounded JPEG frames;
- answers typed or open-microphone questions with Gemini Live native audio;
- sends captured-tab audio only to Google Cloud Speech-to-Text for media
  context;
- suppresses automatic narration while the tab is speaking;
- records grounded, deduplicated visual events in SQLite and shows them in a
  live timeline;
- archives bounded session/event read models for the History dashboard; and
- opens that dashboard from the side panel's **View History** button.

The core trust rule is source separation:

```text
microphone PCM   -> Gemini Live (raw user conversation)
captured-tab PCM -> Cloud Speech-to-Text only (untrusted media context)
screen JPEG      -> Gemini Live context + Gemini Interactions analysis
```

Never send raw captured-tab audio to Gemini Live, never present tab transcript
as user speech, and never put provider credentials in the extension.

## Repository map

| Path | Responsibility |
| --- | --- |
| `package.json`, `scripts/dev-*.js`, `scripts/process-supervisor.js` | Root workspace commands, fixed-port process plans, preflight, and coordinated shutdown. |
| `chrome-extension/extensionManifest.ts` | Testable MV3 manifest: permissions, entry points, loopback hosts, and CSP. |
| `chrome-extension/src/services/background.ts` | Toolbar authorization, side-panel opening, and capture badge updates. |
| `chrome-extension/src/services/captureTarget.ts` | Per-window authorized-tab state and capture startup guards. |
| `chrome-extension/src/sidepanel/App.tsx` | Side-panel composition. |
| `chrome-extension/src/services/backendUrls.ts` | Validated WebSocket/dashboard URL configuration and safe loopback fallback. |
| `chrome-extension/src/sidepanel/components/HistoryNavigation.tsx` | Accessible **View History** navigation into the dashboard. |
| `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts` | Browser orchestration for capture, WebSocket, frames, audio, UI state, and teardown. |
| `chrome-extension/src/sidepanel/realtime/mediaAudio.ts` | Separate tab/mic Web Audio graphs, worklets, resampling, activity, and gain control. |
| `chrome-extension/src/sidepanel/realtime/frameCapture.ts` | Frame sizing, luminance signatures, change detection, JPEG budget, and single-flight capture. |
| `chrome-extension/src/sidepanel/realtime/modelAudioPlayback.ts` | Turn-owned Gemini PCM scheduling and cancellation. |
| `chrome-extension/src/sidepanel/realtime/speechCoordinator.ts` | Barge-in, answer priority, timeouts, and tab duck/restore policy. |
| `chrome-extension/src/sidepanel/realtime/types.ts` | Strict server-message parsing and client-side protocol helpers. |
| `chrome-extension/public/audio/pcm-capture-worklet.js` | Browser render-thread PCM extraction. |
| `ai-voice-realtime/server.js` | Environment bootstrap and process lifecycle. |
| `ai-voice-realtime/src/server/createStreamSenseServer.js` | Testable Express/HTTP/WebSocket construction and session ownership. |
| `ai-voice-realtime/src/session/clientSession.js` | Protocol-v2 orchestration across frames, Live, STT, narration policy, and events. |
| `ai-voice-realtime/src/gemini/vision.js` | Atomic Gemini Interactions request, strict JSON schema, and grounded vision prompt. |
| `ai-voice-realtime/src/gemini/liveSession.js` | Backend-owned Gemini Live connection, turns, transcripts, tools, and reconnects. |
| `ai-voice-realtime/src/stt/googleSpeechTranscriber.js` | Cloud Speech-to-Text V2 streaming, rotation, retry, and transcript timestamps. |
| `ai-voice-realtime/src/session/speechPolicy.js` | Provider-free automatic-narration state machine. |
| `ai-voice-realtime/src/events/` | Event validation, five-second deduplication, and SQLite persistence. |
| `ai-voice-realtime/src/history/` | Bounded history repository/service, archive queue, REST contracts, demo data, and graph read model. |
| `ai-voice-realtime/src/protocol/` | JSON/binary schemas, origin policy, payload limits, and rate limits. |
| `session-dashboard/src/` | History overview, session timeline, search, and accessible context exploration. |
| `session-dashboard/src/features/context/ThreeGraphExplorer.tsx` | Optional Three.js view with DOM selector/list alternatives and WebGL fallback. |
| `docs/context-graph-api.md` | Renderer-neutral graph API, bounds, and exact edge semantics. |
| `docs/semantic-history-integration.md` | Durable repository and semantic retrieval handoff boundary. |
| `docs/superpowers/specs/` | Historical design decisions; useful context, not proof of current behavior. |
| `docs/superpowers/plans/` | Historical implementation plans; unchecked boxes do not mean code is absent. Verify source and tests. |
| `docs/verification/2026-08-04-gemini-live-voice-acceptance.md` | Manual Chrome/provider acceptance ledger. Keep unobserved cases pending. |

`ai-voice-realtime/static/` is a legacy diagnostic web client, not the active
StreamSense frontend. It is incompatible with the current extension-only
origin policy and protocol v2. Do not use it for end-to-end validation or copy
its message shapes into active code.

## Active runtime and models

The supported Live path is:

```text
Chrome toolbar click
  -> background service worker authorizes the exact tab
  -> React side panel starts tab capture, mic, and WebSocket
  -> ws://127.0.0.1:8000/ws
  -> createStreamSenseServer()
  -> one ClientSession per browser socket
```

The History path is:

```text
Side-panel View History
  -> validated loopback /dashboard/ URL in a normal Chrome tab
  -> React dashboard
  -> same-origin /api requests
  -> the same backend process and HistoryService
```

Root development profiles have fixed topology and exactly one backend:

| Command | Ports |
| --- | --- |
| `npm run dev` | backend `8000`, extension `5173`, dashboard `5174` |
| `npm run dev:realtime` | backend `8000`, extension `5173` |
| `npm run dev:dashboard` | demo backend `8000`, dashboard `5174` |

`npm run demo` builds both frontends and starts one demo-history backend serving
the dashboard at `http://127.0.0.1:8000/dashboard/`. Do not combine that command
with another backend process.

Current defaults, all overridable in backend environment configuration:

| Capability | Default | Active API |
| --- | --- | --- |
| Visual analysis | `gemini-3.6-flash` | Gemini Interactions REST API |
| Voice Q&A/narration | `gemini-3.1-flash-live-preview` | `@google/genai` Live API |
| Captured-tab transcription | `chirp_3` | Google Cloud Speech-to-Text V2 |

Do not perform a model-name-only migration. A provider migration must update
the request shape, structured schema, response extraction, error behavior, and
tests together. The current Interactions request uses API revision
`2026-05-20`, `thinking_level: "minimal"`, and no `temperature`.

## Invariants that changes must preserve

1. The backend owns every Google credential and provider session.
2. Only microphone PCM can be raw Gemini Live conversational audio.
3. Captured-tab PCM goes only to Cloud STT; its transcript is bounded,
   short-lived, labeled non-user, and treated as untrusted.
4. Gemini Live automatic activity detection remains disabled. Microphone turns
   use explicit start/end boundaries; typed text and app narration are not
   microphone activity.
5. Every answer/narration output is owned by a turn ID. Stale or ambiguous
   audio/transcripts are dropped, never guessed or transferred.
6. Delivery-ambiguous text, PCM, activity boundaries, and tool responses are
   never replayed after reconnect. Only the latest immutable video frame is
   safe to resend.
7. A user turn has priority over automatic narration. Barge-in clears displaced
   playback; tab speech blocks/cancels narration but not a user answer.
8. Tab gain is ducked to 30 percent only for user answers and returns to 100
   percent only after local Gemini PCM playback is idle.
9. Frame analysis is single-flight with latest-frame coalescing. Do not abort
   every slow request; stable-frame provider/schema failure gets at most one
   bounded retry.
10. Protocol input and server output remain strict. Unknown fields, malformed
    JSON/binary packets, unsafe origins, and limit violations must not become
    provider input.
11. Stop, target change, video end, socket close, and page hide must release
    tracks, nodes, worklets, timers, provider sessions, queued playback, and
    in-memory transcript context exactly once.
12. Automated tests are not physical Chrome/provider acceptance.
13. The context renderer visualizes only validated API nodes and edges. Layout,
    shapes, and colors must not invent semantic relationships or confidence.
14. The Three.js canvas is optional. The labeled selector and readable DOM
    relationships remain available to keyboard and assistive-technology users,
    and WebGL failure must degrade without breaking History.
15. Replacing graph data or leaving the route must cancel pending animation,
    disconnect observers/listeners, remove labels, and dispose controls,
    geometries, materials, and the WebGL renderer.

## Protocol-change checklist

The active protocol is version 2. If a message or field changes, update all of
the following in the same change:

- backend parser/output schema in `ai-voice-realtime/src/protocol/`;
- backend routing in `ClientSession`;
- extension type and strict parser in `realtime/types.ts`;
- extension send/receive orchestration in `useRealtimeSession.ts` or
  `mediaAudio.ts`;
- backend and extension protocol-contract fixtures/tests;
- `architecture.md` when the boundary materially changes.

Binary audio uses a fixed ten-byte little-endian header and source-specific PCM
limits. Do not change it on only one side.

## Safe development workflow

1. Read the active call path and the closest tests before editing.
2. Check `git diff` for user changes in every file you need to touch.
3. Add a focused regression test for behavior changes.
4. Make the smallest state-machine or boundary change that satisfies it.
5. Run focused tests during iteration.
6. Run the full gates below before reporting completion.
7. For Chrome/provider behavior, update the acceptance record only with an
   actual sanitized observation. Leave every unobserved case `PENDING`.

Prefer root profiles for integrated work. A package-scoped backend `npm start`
is still appropriate for an intentionally backend-only stable run, but first
confirm port `8000` is not owned by a root profile.

## Setup and commands

Install once from the repository root:

```bash
npm install
npm run build
```

Copy `ai-voice-realtime/.env.example` to `ai-voice-realtime/.env` when working
on the Live provider path. Required settings are documented in that file and
the backend README. Never print or commit the populated `.env`, API keys, ADC
paths, service-account JSON, private transcripts, or signed-in account data.

Integrated commands:

```bash
npm run dev
npm run dev:dashboard
npm run dev:realtime
npm run demo
```

Load `chrome-extension/dist` as unpacked in `chrome://extensions`, copy the
generated extension ID to `STREAMSENSE_EXTENSION_ID`, restart the backend, and
click the toolbar action on the exact tab to authorize it. In the full dev
profile, **View History** targets `http://127.0.0.1:5174/dashboard/`. In the
realtime-only profile it falls back to the backend `/dashboard/` route, which
requires a previously built `session-dashboard/dist`.

Full automated gates:

```bash
npm run check
git diff --check
git status --short
```

The root check runs orchestration tests, backend checks, extension tests and
build, plus dashboard tests, type checking, and build. It does not replace
physical Chrome/provider acceptance.

Backend integration tests bind temporary loopback ports. A restricted sandbox
may return `listen EPERM`; rerun with loopback permission before treating that
as a project failure.

## Evidence and known gaps

Do not freeze historical test counts or another branch's provider observation
into a completion claim. Run `npm run check` and the relevant manual acceptance
against the active checkout, then report the exact commands and observations.

Do not claim the following as working yet:

- the 12-case real Chrome/provider acceptance matrix; all cases remain pending;
- real Cloud STT capture/rotation in this checkout and environment;
- real microphone permission, acoustic isolation, gain, barge-in, and teardown
  behavior in Chrome;
- the legacy `ai-voice-realtime/static/` diagnostic page;
- graceful frontend handling of the backend's 500-character typed-question cap
  and one-question-per-two-seconds limit—the UI currently does not enforce
  either, so the backend can close the socket for a violating client;
- durable history across backend restarts: the extension shows current-session
  events and opens the History dashboard for archived reads, but the current
  normal/demo dashboard repositories are process-local memory;
- production semantic retrieval: the built-in demo adapter is deterministic,
  while durable storage, embeddings/vector search, Redis current context, and
  calibrated semantic scoring remain integration boundaries;
- physical accessibility and GPU acceptance for the optional Three.js view:
  automated tests do not replace keyboard, contrast, reduced-motion, WebGL
  fallback, and cleanup inspection in a real browser;
- a remote or production deployment—the manifest, CSP, and defaults are
  intentionally loopback-only.

## Review hotspots

The separation of concerns is sound, but several orchestration files are large
and high-risk:

- `useRealtimeSession.ts` owns many browser lifecycle concerns;
- `ClientSession` coordinates all backend subsystems;
- `GeminiLiveSession` owns several asynchronous ownership queues;
- `mediaAudio.ts` owns two Web Audio graphs plus state degradation.

Avoid opportunistic rewrites. If a feature makes one of these files grow,
extract a cohesive state machine or adapter with focused tests; do not split by
arbitrary “controller/service/helper” layers.

## Completion standard

A change is complete only when:

- the active runtime path, not a legacy helper, contains the change;
- cross-boundary schemas and contract tests agree;
- source separation, turn ownership, and teardown invariants still hold;
- relevant focused tests and the root `npm run check` gate pass freshly;
- `git diff --check` passes and user-owned changes remain intact;
- real-world claims are limited to actually observed acceptance evidence;
- remaining risks and unverified behavior are stated plainly.
