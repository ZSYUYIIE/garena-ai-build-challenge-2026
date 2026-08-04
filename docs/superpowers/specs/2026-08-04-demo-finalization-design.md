# StreamSense Hackathon Demo Finalization Design

## Context

The earlier hardening work made StreamSense resilient at the WebSocket boundary and fixed Chrome tab-capture authorization, cancellation, timestamp ownership, badge synchronization, protocol drift, and setup documentation. Five remaining items are worth addressing before the hackathon demo:

1. Complete a real Chrome-to-Gemini acceptance run.
2. Improve the default sampled-frame resolution used by narration and questions.
3. Migrate atomic vision requests from `generateContent` and deprecated `responseSchema` fields to the Gemini Interactions API.
4. Remove unused extension entry points, permissions, and status-message infrastructure.
5. Remove the vulnerable unused `shadcn` dependency chain and Vite native-config warnings.

The implementation must preserve the existing atomic single-frame architecture. It will not reintroduce Gemini Live video, WebRTC, or an on-demand capture path for questions.

## Goals

- Send useful 720p-class samples by default without upscaling small sources.
- Use the current Gemini Interactions API structured-output contract while preserving cancellation and runtime validation.
- Reduce the extension to the entry points and permissions used by the demo.
- Produce clean builds and production dependency audits.
- Verify the complete demo flow in a real Chrome session against Gemini.

## Non-goals

- Increasing the one-frame-per-second sampling cadence.
- Capturing an extra frame when the user asks a question.
- Replacing raw REST calls with the Google Gen AI SDK.
- Moving the backend to Gemini Live, Vertex AI, or a persistent multi-turn interaction.
- Redesigning the side-panel UI.
- Fixing unrelated speculative or low-priority repository concerns.

## Considered Approaches

### 1. Raw Interactions API migration (chosen)

Keep the backend's existing `fetch` boundary and move only the request/response contract to `POST /v1beta/interactions`. This preserves direct `AbortSignal` support, adds no dependency, and limits demo risk.

### 2. Google Gen AI SDK v2 migration

Adding `@google/genai` would provide higher-level interaction helpers, but it would also add a dependency and require separate cancellation-behavior validation. That churn is not justified for the current two stateless vision operations.

### 3. Broader capture and API refactor

A larger refactor could introduce a shared media pipeline and persistent interaction state. It would improve long-term extensibility but expand the failure surface immediately before the demo.

## Architecture

The topology remains:

```text
Chrome tab -> sampled JPEG -> loopback WebSocket -> Gemini Interaction -> panel narration/answer
```

### 1. Default frame sampling

The extension will continue sampling at most once per second and sending only frames that pass the existing meaningful-change check.

Frame dimensions will be computed by a pure helper:

- Maximum output width: 1280 pixels.
- Preserve the source aspect ratio.
- Never upscale a source narrower than 1280 pixels.
- Use a 1280x720 fallback when the video element has not exposed dimensions.
- Encode as JPEG at quality `0.8`.

For a normal 16:9 tab this produces a 1280x720 sample. Questions continue to use the latest sample already held by the backend, so they can be up to one sampling interval behind the visible tab. This is an explicit tradeoff chosen for predictable cost and implementation simplicity.

The sizing helper and constants will live in a small realtime frame-capture module and will be unit tested independently from React and canvas APIs.

### 2. Gemini Interactions API

`ai-voice-realtime/src/gemini/vision.js` will keep a shared request helper but change its wire contract to the official Interactions API:

- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/interactions`.
- Authentication: `x-goog-api-key` header rather than a query parameter.
- API revision: `Api-Revision: 2026-05-20`.
- Input: one text content block and one inline image content block using `data` and `mime_type`.
- Output constraint: top-level text `response_format` with `mime_type: application/json` and the operation's JSON Schema.
- Generation configuration: `max_output_tokens: 512` and `thinking_level: minimal`.
- Storage: `store: false`, because each frame analysis is stateless and the app already owns its limited session memory.

The helper will extract and concatenate text content from `model_output` steps, parse the JSON, and then retain the existing Zod validation for application-level limits. Provider HTTP errors, empty output, malformed JSON, and schema violations remain recoverable analysis errors at the session layer. The existing `AbortSignal` remains attached to `fetch`, so replacement, stop, disconnect, and timeout cancellation behavior is unchanged.

The official API reference describes the Interactions endpoint, inline image content, structured text response format, response steps, and `store` behavior: <https://ai.google.dev/api/interactions>.

### 3. Extension cleanup

The extension will remove the unused surfaces completely:

- Delete the global HTTPS content script and its manifest entry.
- Delete the unused popup entry point and markup.
- Delete `ExtensionStatusService` and its legacy message types.
- Remove the background runtime-message listener and manual status-toggle helpers.
- Remove the unused `contentSettings` permission.

The background service worker will retain only toolbar capture authorization, tab-capture badge synchronization, and default badge initialization. The side panel, `activeTab`, `sidePanel`, `storage`, `tabCapture`, and loopback host permissions remain required.

### 4. Dependencies and build configuration

The application does not use the `shadcn` CLI at runtime. The package is imported only for generic Tailwind variants/utilities, while its CLI dependency graph pulls server packages into the production audit. The package and CSS import will be removed. Tailwind's data-attribute variants already cover the React Aria state attributes used by the checked-in components; focused build and visual checks will catch any missing styling behavior.

Vite configuration will stop using CommonJS `__dirname` in an ES module and will derive the source path from `import.meta.url`. JSON imports in Vite and manifest configuration will use import attributes supported by the current TypeScript/Vite toolchain. This removes the native config-loader warnings without changing build output structure.

## Error Handling

- Source dimensions that are zero or unavailable use the 1280x720 fallback; valid smaller sources remain at native size.
- A failed JPEG conversion leaves the frame loop available for its next interval, as today.
- Gemini non-2xx responses include the provider's safe error detail but never expose the API key, which is no longer present in the URL.
- A completed interaction with no model-output text is treated as an empty structured result and follows the existing recoverable analysis-error path.
- Cleanup removes only unreachable extension surfaces; capture authorization and status badge behavior stay event-driven.

## Testing Strategy

Implementation will be test-driven.

Extension tests will cover:

- 1920x1080 becomes 1280x720.
- A smaller source is not upscaled.
- Non-16:9 aspect ratios are preserved.
- Missing video dimensions use the fallback.

Backend tests will verify:

- The Interactions endpoint and headers.
- Text and image input content.
- Structured response format, generation configuration, and `store: false`.
- Abort-signal propagation.
- Model-output text extraction and existing Zod validation.
- Provider failure and empty-output behavior where existing coverage is insufficient.

Repository verification will run:

```bash
cd ai-voice-realtime
npm test
npm run check
npm audit --omit=dev

cd ../chrome-extension
npm test
npm run build
npm audit --omit=dev
```

The final acceptance run will rebuild and reload the unpacked extension, start the backend with `npm start`, authorize an ordinary HTTPS tab, start capture, observe Gemini narration, ask a grounded question, stop capture, and confirm session and badge cleanup. Credentials and signed-in browser state will never be printed.

## Acceptance Criteria

- Normal 16:9 tabs are sampled at 1280x720 by default, with no upscaling of smaller sources.
- Sampling remains at most one frame per second and questions use the latest sampled frame.
- Vision analysis and answers use the Gemini Interactions API with structured JSON output, `store: false`, and working cancellation.
- No global content script, unused popup, legacy status-message subsystem, or `contentSettings` permission remains.
- The unused `shadcn` dependency and its audit findings are removed.
- Extension builds no longer emit the identified Vite native-config warnings.
- Backend tests/checks, extension tests/build, and production dependency audits pass.
- A real Chrome-to-Gemini demo flow succeeds, or any external-state blocker is documented precisely and separately from automated verification.
