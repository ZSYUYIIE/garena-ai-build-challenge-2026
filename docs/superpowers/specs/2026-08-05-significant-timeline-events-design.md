# Significant Timeline Events Design

**Date:** 2026-08-05

## Context

StreamSense currently samples the captured tab once per second, computes a low-resolution luminance signature from one center pixel per grid cell, and sends a frame only when a global visual-change threshold is crossed. Each admitted frame is analyzed by the atomic Gemini vision path. The result may create a structured event or a fallback visual-change event, which is persisted and published to the extension's Timeline. Similar events of the same type and description are suppressed for 12 seconds.

This pipeline already observes both video playback and page scrolling as changed pixels, but it has two recall gaps:

- A small, spatially concentrated change, such as a scoreboard digit, may fall between signature sample points or be too small to cross the global frame threshold.
- A large page-section transition may reach Gemini, but the current prompt does not explicitly classify materially new visible sections as timeline events.

The Timeline should record significant visible developments from dynamic media and materially different content exposed while browsing. It should not record every animation frame, caption update, cursor blink, or incremental scroll position.

## Goals

- Admit modest global changes and compact local changes for semantic analysis without relying on isolated center-pixel samples.
- Record materially new visible sections, such as comments, results, or product details.
- Record significant dynamic events, such as goals, score changes, winner announcements, major alerts, and state transitions.
- Keep timeline descriptions grounded in the visible result rather than inferring a click or scroll action.
- Reduce same-event duplicate suppression from 12 seconds to 5 seconds.
- Preserve the current one-frame-per-second limit, latest-frame coalescing, bounded backpressure behavior, and atomic Gemini Interactions architecture.

## Non-goals

- Recording every scroll tick, video frame, subtitle change, animation, or cursor movement.
- Claiming that the user clicked, scrolled, or navigated based only on captured pixels.
- Adding a content script, DOM inspection, scroll listeners, new Chrome permissions, or page-specific integrations.
- Increasing capture cadence beyond one frame per second.
- Changing Gemini Live audio, Q&A, narration scheduling, or speech-suppression policy.
- Redesigning the Timeline UI or changing its 100-item in-memory display limit.

## Considered Approaches

### 1. Lower only the global frame threshold

Reduce the existing changed-sample ratio and average-difference thresholds. This is the smallest implementation, but a threshold low enough to catch a tiny scoreboard can also admit isolated noise and ordinary video churn. It still treats all visual changes as whole-frame changes.

### 2. Modest global relaxation plus a localized trigger (chosen)

Replace the sparse 48-column center-sample signature with a 96-column area-averaged signature, slightly relax the global thresholds, and add a compact-change trigger. Gemini remains the semantic gate that decides whether an admitted change is significant enough for the Timeline. This improves recall for page-section transitions and small overlays without analyzing every captured frame.

### 3. Analyze every sampled frame

Send every one-second sample and let Gemini make the entire significance decision. This maximizes visual recall but increases provider traffic, latency pressure, and routine-motion analysis. It is unnecessary while a bounded local detector can recover the important cases.

## Chosen Design

### 1. Testable visual-change detector

Move the signature construction and visual-change decision from the React session hook into the existing realtime frame-capture module. The hook will continue to own canvas capture, rate limiting, backpressure, and WebSocket delivery; the frame-capture module will own only pure signature and comparison logic.

Replace the center-pixel signature with an area-averaged luminance grid. The signature has 96 columns, rows derived from the captured aspect ratio, and explicit `{ columns, rows, luminance }` metadata. Each signature value is the average luminance of the source-pixel rectangle represented by that cell. This keeps the comparison compact while ensuring that a small raster change contributes even when it falls between the old sample locations.

Signatures are compatible only when both dimensions match. A frame is admitted when any of these conditions is true:

1. There is no previous compatible signature.
2. At least `0.8%` of samples differ by `18` or more, reduced from `1.2%`.
3. Mean absolute luminance difference is at least `4`, reduced from `5`.
4. At least two horizontally or vertically adjacent cells differ by `24` or more, providing a bounded localized trigger for compact overlays and scoreboard changes.

Horizontal adjacency is evaluated only within the same row; vertical adjacency is evaluated at the same column in consecutive rows. Flattened row boundaries are never treated as adjacent. One isolated high-difference cell will not pass the localized trigger. This prevents a single noisy cell or cursor blink from admitting a frame by itself. The detector remains a cheap prefilter, not an event classifier.

The previous signature is updated only after a valid JPEG is produced and retained for delivery, preserving the current retry behavior when encoding or transport admission fails.

### 2. Grounded prior-state comparison

The current frame remains authoritative for claims about what is visible now, but transition event types require temporal evidence. Extend the structured vision-analysis result with a nullable `visibleState`:

```text
visibleState = {
  domain: lowercase snake_case state family of at most 80 characters,
  identity: stable tracked-subject identity of at most 160 characters,
  value: current visible value of at most 160 characters,
  summary: concise grounded description of at most 300 characters
}
```

`identity` excludes the changing value and should use readable participants, competition, page title, document title, or another grounded stable cue. State strings are trimmed, internal whitespace is collapsed, and compatibility keys are lowercased. A state is compatible only when both normalized `domain` and `identity` exactly match. A different match, page, document, or tracked subject is incompatible even when its domain is the same.

The backend will retain at most eight grounded states keyed by normalized `domain + identity`, each for at most 120 seconds of backend session time. A successful non-null current state updates only its compatible cache entry. A null state does not erase unrelated cached entries, allowing `score 1-1 -> routine play with no trackable state -> score 2-1` to retain valid score history. Expiry, session close, or bounded oldest-entry eviction removes state. Chronologically older or aborted results cannot update the cache.

The prompt will require `visibleState` whenever the current frame contains a reliably readable trackable state, even when `shouldNarrate` is false or no event occurred. It will use null when no stable domain, identity, and value can be grounded. Gemini receives one exact current frame, the bounded cached prior states, the current session timestamp, and bounded untrusted captured-tab transcript context through the structured Interactions request. Prior state may identify a transition only when its domain and identity are compatible with the current state; it cannot justify a current visual claim absent from the attached frame.

When no compatible prior state exists, the model must use a grounded state event such as `score_visible` rather than claiming `score_changed`. `goal_scored` requires either explicit current-frame evidence such as a readable goal banner or a compatible prior/current score transition with visible sports context. A static score by itself does not prove that a goal occurred.

### 3. Grounded significance classification

The analysis prompt will explicitly distinguish visual admission from timeline significance:

- A materially different dominant section becoming visible is a timeline event when it exposes useful new content, such as a comments section, results table, product details, checkout confirmation, or new article section.
- A significant dynamic occurrence is a timeline event when the current frame and permitted prior grounded state support it, including a goal, score or lead change, winner announcement, major alert, presentation-state change, or other consequential on-screen transition.
- Routine sports motion, camera movement, caption churn, autoplay controls, hover effects, minor animation, and incremental scrolling remain non-events.
- `event` is independent of `shouldNarrate`. A significant visible event may be recorded even when narration is disabled or suppressed.
- Descriptions state the observed result, such as “The comments section is now visible” or “The score changes to 2–1.” They must not state “the user scrolled,” “the user clicked,” or another unobserved cause.
- `event` remains `null` when significance or visual evidence is insufficient.

The persisted event schema remains unchanged, but the vision-analysis schema gains a nullable `eventEvidence` alongside `visibleState`:

```text
eventEvidence = {
  basis: current_frame | state_transition,
  previousState: visibleState | null
}
```

`event` and `eventEvidence` must either both be present or both be null. For `state_transition`, `visibleState` and `previousState` are required; the backend records the event only when the previous state matches a non-expired cached entry, the current state has the same domain and identity, and the values differ. Transition event types such as `score_changed` require this validated basis. `current_frame` requires `previousState: null` and supports state events or explicit current-frame announcements. An invalid evidence relationship is dropped with bounded telemetry rather than persisted.

Gemini will use specific lowercase snake-case event types where supported by the available evidence, such as `section_visible`, `score_visible`, `goal_scored`, `score_changed`, or `winner_announced`. Fallback narrated changes continue to use `scene_observed` or `visual_change`. The backend can deterministically validate state-transition consistency; semantic correctness of explicit current-frame events remains a prompt/provider responsibility and is covered by provider acceptance rather than claimed from mocks alone.

### 4. Bounded analysis retry

A provider or schema failure must not permanently hide a significant screen that remains stable after its first admitted frame. The backend will retry the same immutable frame snapshot once after one second when all of these remain true:

- the failure was not an intentional abort;
- the session is still open;
- no newer frame has been accepted or queued; and
- no analysis for that snapshot is already active.

The retry is canceled when a newer frame arrives or the session closes. Retry ownership belongs to the immutable snapshot's existing `frameSequence`; the hash is used only to confirm that snapshot is still current. The snapshot record carries a single retry-attempted flag, so no session-wide hash set is created. A second failure records no event and waits for a changed frame. The same visual hash may receive a fresh one-retry budget if it legitimately reappears later under a new frame sequence. This policy reuses the existing single-flight ownership and cannot create an unbounded retry loop.

### 5. Event recording and duplicate suppression

Define and export one `DEFAULT_DUPLICATE_WINDOW_SECONDS = 5` constant from the deduplication module. Both the standalone deduplicator and `EventStore.record` will use that shared default. Within the inclusive five-second window, an event is suppressed only under the existing rule: it has the same event type and either the same normalized description or description similarity at or above the existing threshold. A candidate more than five seconds after the prior event is eligible to be recorded again.

No database migration is required because the duplicate window is runtime policy rather than persisted schema. Recorded events retain their current timestamp, type, entities, description, importance, and confidence fields. The extension continues inserting newly published events at the top of the Timeline and retaining at most 100 in memory.

### 6. Runtime data flow

The runtime remains:

```text
captured tab
  -> one-second frame sample
  -> global-or-local visual-change detector
  -> bounded JPEG and WebSocket delivery
  -> single-flight latest-frame Gemini analysis with one bounded stable-frame retry
  -> current frame plus prior grounded-state comparison
  -> grounded semantic significance decision
  -> five-second duplicate check
  -> SQLite event record
  -> Timeline publication
```

Changing the visual detector does not bypass transport rate limits or provider single-flight ownership. If analysis takes longer than the sampling interval, the backend continues retaining only the newest immutable pending frame.

## Error Handling and Safety

- Invalid or incompatible signatures admit the next frame as a fresh baseline rather than failing capture.
- JPEG encoding failure, WebSocket backpressure, and stale-session checks retain their current behavior.
- Gemini failure or schema-invalid output records no event, receives at most one retry for the same still-current frame sequence, and then waits for a changed frame after a second failure.
- Invalid or incompatible transition evidence is not persisted and cannot mutate the grounded-state cache.
- A frame that passes visual detection but is semantically routine produces no Timeline entry.
- Self-descriptions of the StreamSense panel and inferred user actions remain suppressed.
- No new browser permission, host access, page injection, or persistent browsing telemetry is introduced.

## Testing Strategy

Implementation will be test-driven.

### Extension unit tests

The pure detector will cover:

- First or dimension-incompatible signatures are admitted.
- Area-averaged signatures detect synthetic raster patches placed both on and between the old center-sample locations.
- A distributed `0.8%` changed-sample case is admitted.
- Mean absolute difference of `4` is admitted.
- Two horizontal or vertical adjacent cells differing by at least `24` are admitted as a localized change.
- Flattened indices on opposite sides of a row boundary are not treated as adjacent.
- One isolated strong cell is rejected when no global rule passes.
- Sub-threshold noise is rejected.
- The session frame loop and capture scheduler still enforce one-second delivery, latest-frame retention, and no overlapping capture.
- A failed JPEG-to-base64 conversion or failed transport admission does not commit the candidate signature, so an identical later frame remains eligible.
- Successful immediate delivery or bounded latest-frame retention commits the signature exactly once.

### Backend prompt and session tests

- The analysis prompt identifies materially new visible sections and significant dynamic events as event candidates.
- Prompt wording requires observed-state descriptions and forbids inferred user actions.
- A `section_visible` result received through the real `video_frame` browser-message path is validated, persisted, and published.
- A compatible prior-state/current-state sequence through that path can produce `score_changed` only when backend-validated transition evidence exists.
- An interstitial routine frame with null state does not erase a non-expired compatible score state.
- A different match, page, or state identity cannot supply transition evidence.
- A static score without compatible prior state cannot pass backend validation as `score_changed`; it can produce a state event such as `score_visible`.
- `goal_scored` with explicit current-frame evidence is covered by prompt-contract tests and real provider acceptance rather than treated as semantically proven by a mocked analysis result.
- An event is still recorded when `shouldNarrate` is false.
- Routine motion and caption-only analyses do not publish events.
- Single-flight latest-frame coalescing remains intact under slow analysis.
- One failed analysis of a stable frame sequence is retried once, a newer frame cancels the retry, and a second failure does not loop.
- The same image hash appearing under a later frame sequence receives its own bounded retry budget.

### Event-store tests

- The standalone deduplicator and event store both use the shared five-second default.
- A same-type, similar event at exactly five seconds remains a duplicate.
- The same candidate more than five seconds later can be recorded.
- Distinct event types or meaningfully different descriptions remain recordable inside the window under the existing similarity rules.

### Verification

Run the full automated gates:

```bash
cd ai-voice-realtime
npm run check

cd ../chrome-extension
npm test
npm run build
```

Manual Chrome/provider acceptance will verify two cases with the rebuilt extension and stable backend:

1. Start on a page heading, scroll until a materially different comments section dominates the captured tab, and confirm one grounded section event appears without an event for every intermediate scroll position.
2. Play a known sports segment containing a visible goal or score change and confirm the significant change appears while ordinary motion and caption churn do not flood the Timeline. Also present a static score with no compatible prior state and an incompatible prior match to confirm they do not create an unsupported transition event.

Automated success must not be presented as physical Chrome/provider acceptance if these manual cases have not been observed.

## Acceptance Criteria

- Sampling remains limited to one frame per second.
- Large section transitions and compact raster changes that affect two adjacent area-averaged cells are eligible for Gemini analysis under the specified thresholds.
- A materially new visible section can produce a grounded Timeline entry without claiming that the user scrolled.
- A visibly supported goal, score change, winner announcement, or comparable consequential event can produce a Timeline entry without claiming a transition from a static frame or incompatible prior state alone.
- Routine motion, captions, minor animation, and incremental scrolling do not flood the Timeline.
- Timeline event recording works independently from spoken narration eligibility.
- One transient analysis failure does not permanently hide an otherwise stable significant screen, and retry remains bounded to one attempt per immutable frame sequence.
- Same-type similar events are suppressed for five seconds rather than 12 seconds, with candidates after five seconds eligible again.
- No content script, scroll telemetry, new Chrome permission, or Timeline UI redesign is introduced.
- Backend checks, extension tests, and the extension production build pass.
- Manual section-transition and dynamic-event acceptance results are reported separately and truthfully.
