# Gemini Live Voice Acceptance Record

This record separates reproducible automated gates from real Chrome/provider
observations. It contains no API keys, credential paths, private transcript
text, or signed-in account details.

## Verification metadata

| Field | Value |
| --- | --- |
| Branch | `codex/gemini-live-voice-context` |
| Automated verification date | 2026-08-05 04:31 +08 (Asia/Singapore) |
| Automated base commit | `0d29e67e0e19` |
| Automated runtime | Node.js `v24.15.0`; npm `12.0.2` |
| Browser/provider smoke date | 2026-08-05 04:33 +08 (Asia/Singapore) |
| Manual acceptance date | Pending |
| Chrome version and platform | Unavailable; automation security policy blocked `chrome://extensions` |
| Extension ID | Redacted by design |
| Provider configuration | Gemini Live credential configured for sanitized connect/close; Cloud Speech project/ADC prerequisite absent; identifiers and credentials redacted |

The metadata and automated evidence table below are a frozen record of the
identified 2026-08-05 checkout. They are not a passing result for the current
checkout. The still-pending manual criteria were reconciled on 2026-08-09 with
the current extension-owned Chrome timeline TTS architecture; no pending case
was promoted to PASS.

Status vocabulary:

- **PASS**: observed result met every listed criterion.
- **FAIL**: observed result diverged; the evidence column contains a sanitized
  symptom and follow-up reference.
- **PENDING**: no real observation has been made yet. Automated tests alone do
  not change a manual case to PASS.

## Automated release gates

Clean dependency installs use the committed lockfiles and the shared npm cache
at `/private/tmp/garena-ai-build-npm-cache`. Credential values and ADC locations
must not appear in captured output.

| Timestamp (Asia/Singapore) | Area | Command | Result | Sanitized evidence |
| --- | --- | --- | --- | --- |
| 2026-08-05 04:31 +08 | Backend | `npm ci --cache /private/tmp/garena-ai-build-npm-cache` | PASS | Clean lockfile install added 205 packages; npm reported 0 vulnerabilities. Deprecation and blocked install-script warnings were visible; subsequent tests passed. |
| 2026-08-05 04:31 +08 | Backend | `npm test` | PASS | 177 tests passed; 0 failed, skipped, cancelled, or todo. |
| 2026-08-05 04:31 +08 | Backend | `npm run check` | PASS | `node --check server.js` passed, followed by 177 passing tests. |
| 2026-08-05 04:31 +08 | Extension | `npm ci --cache /private/tmp/garena-ai-build-npm-cache` | PASS | Clean lockfile install added 114 packages; npm reported 0 vulnerabilities. One blocked optional install-script warning was visible; tests and build passed. |
| 2026-08-05 04:31 +08 | Extension | `npm test` | PASS | 104 tests passed; 0 failed, skipped, cancelled, or todo. |
| 2026-08-05 04:31 +08 | Extension | `npm run build` | PASS | TypeScript and Vite 8.2.0 production build passed; 3,121 modules transformed and `dist` plus the packaged archive were produced. |
| 2026-08-05 04:31 +08 | Repository | manual command-output review plus credential-pattern scan of changed docs and built extension | PASS | No API-key pattern, private-key material, service-account/ADC path, private transcript text, or account detail was retained. |
| 2026-08-05 04:33 +08 | Gemini Live | Sanitized real `start()` then `close()` smoke with the configured backend credential and a 20-second bound | PASS | A real Live session connected and closed within the bound. This proves provider connectivity only, not extension audio, screen context, narration, or playback behavior. |
| 2026-08-05 04:33 +08 | Backend | Normal `npm start` loopback startup smoke using the local-development origin override; injected Ctrl-C observation | PASS | The server started on an ephemeral loopback port. Injected Ctrl-C produced no shutdown-error log, but the harness reported process exit code 1, so this does not prove a zero-exit shutdown. No extension client connected; the permissive flag was limited to this startup smoke. |
| 2026-08-05 04:34 +08 | Final regression | Backend `npm test` + `npm run check`; extension `npm test` + `npm run build` | PASS | Backend passed 177/177 tests and syntax check; extension passed 104/104 tests and rebuilt the production package. The final credential/private-path scan returned no matching artifact. |

The deterministic fake-clock Live resumption and Cloud STT rotation tests are
release gates. Provider timing is not deterministic enough to replace them.

## Environment limitations

- Cloud Speech-to-Text could not be exercised because the required Cloud
  project/ADC prerequisite is absent in this environment. No tab-STT acceptance
  case is marked PASS.
- Browser automation attempted to open `chrome://extensions`, but the browser
  security policy blocked access. Extension reload, toolbar authorization,
  side-panel capture, microphone permission, audio gain, and teardown behavior
  were not observed. The operator must complete every manual case below.

## Real Chrome/provider acceptance matrix

Before each case, build the extension, start the backend with `npm start`, load
`chrome-extension/dist`, confirm exact extension-ID allowlisting, and use only
sanitized test content. Record the Chrome version, platform, timestamp, visible
UI/provider state, gain behavior, and teardown observation. Do not paste
transcripts, account names, request payloads, credentials, or local ADC paths.

| # | Scenario and pass criteria | Status | Timestamp | Sanitized observed evidence |
| --- | --- | --- | --- | --- |
| 1 | **Silent slide/UI change.** One grounded event is recorded and inserted into the timeline before Chrome/OS TTS reads its exact description; Smart narration leaves captured-tab gain at 100 percent. | PENDING | Pending | Real Chrome/provider and Chrome/OS TTS run required. |
| 2 | **Continuously narrated sports and mode behavior.** Smart narration waits for 750 milliseconds of continuous silence from local tab activity; Narrate over audio can speak immediately and holds local tab gain at 40 percent only from the Chrome TTS `start` event to a terminal event; Narration only keeps local playback muted without stopping captured-tab PCM. | PENDING | Pending | Real Chrome/provider run required in all three modes. |
| 3 | **User voice question during sports.** Any active Chrome timeline utterance and pending event are cleared before question admission; tab playback fades to 0 percent while the user speaks and 30 percent while Live answers; Live uses the current screen and recent labeled tab transcript when relevant; gain returns to the mode baseline only after the local Gemini PCM queue is idle. | PENDING | Pending | Real Chrome/provider run required. |
| 4 | **User interruption.** New independent user speech stops the old Gemini audio immediately; stale chunks from the displaced turn never resume. | PENDING | Pending | Real Chrome/provider run required. |
| 5 | **Captured-tab dialogue isolation.** Tab speech may update media context but never creates a user chat entry or Gemini Live user-activity turn. | PENDING | Pending | Real Chrome/provider run required. |
| 6 | **Microphone denial.** Denying the first permission prompt reports voice degraded, preserves tab capture, and leaves typed questions available. | PENDING | Pending | Real Chrome/provider run required. |
| 7 | **No tab-audio track.** Q&A and visual frames continue; a recorded timeline event remains eligible for Chrome TTS, with Smart relying only on local tab activity. | PENDING | Pending | Real Chrome/provider and Chrome/OS TTS run required. |
| 8 | **Forced STT failure.** An audio-bearing tab shows speech context degraded without disabling Chrome timeline TTS or user Q&A. Smart continues to use local tab activity, while the other Voice narration modes do not wait for silence. | PENDING | Pending | Real Chrome/provider run required. |
| 9 | **Live reconnect.** Observe a real `GoAway`, or explicitly record a test-only forced reconnect; resume with current context and no microphone PCM replay. The deterministic resumption unit test remains the release gate. | PENDING | Pending | Real Chrome/provider run or documented test-only trigger required. |
| 10 | **STT rotation.** At least six minutes of tab speech crosses the pre-five-minute stream rotation with no duplicated final segment. | PENDING | Pending | Real Cloud STT run required. Do not record transcript text. |
| 11 | **Lifecycle cleanup.** Verify Stop, captured-tab switch/end, and side-panel close separately; capture, mic, Chrome timeline TTS, Gemini playback, Live, STT, timers, and transcript memory all stop or clear. | PENDING | Pending | Real Chrome/provider run required for all three paths. |
| 12 | **Acoustic isolation and barge-in.** With speakers, tab/Gemini playback alone does not open a user turn when AEC and the echo-aware gate are healthy; independent speech still interrupts. Repeat with headphones as the reliable baseline and record any residual speaker-mode limitation. | PENDING | Pending | Real speaker and headphone runs required. |

## Permission decision record

The original 2026-08-05 snapshot did not justify a microphone-related manifest
change. The current architecture subsequently added the consumer permission
`tts` so the extension can use installed Chrome/OS voices for recorded timeline
events; StreamSense does not provide a speech engine and must not request
`ttsEngine`. Physical Chrome/OS TTS acceptance remains pending. If the side
panel cannot present the microphone prompt, first record the Chrome version,
exact sanitized error, reproduction steps, and permission state here. Do not
add `audioCapture`, `offscreen`, broad host permissions, or a remote-code CSP
allowance speculatively.

## Release disposition

- Recorded automated gates for the identified 2026-08-05 snapshot: **PASS**
- Current-checkout automated gates in this record: **NOT RUN**
- Manual matrix: **PENDING (12/12)**
- Release acceptance: **PENDING real Chrome/provider evidence**
