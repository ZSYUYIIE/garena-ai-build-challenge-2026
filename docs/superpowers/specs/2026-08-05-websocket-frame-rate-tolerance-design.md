# WebSocket Frame-Rate Tolerance Design

## Problem

StreamSense sends changed screen frames on a one-second cadence. The backend
currently enforces one frame in every rolling one-second window and closes the
browser WebSocket on the first rejected frame. Scheduler and delivery jitter can
therefore turn a healthy one-frame-per-second producer into a fatal policy
violation. The extension then hides the WebSocket close code and reason behind a
generic `Backend connection closed.` status.

## Decision

Keep one frame per second as the sustained rate, but give the backend frame
limiter a one-frame burst capacity. This is a token-bucket policy with a refill
rate of one token per second and a capacity of two frames. It accepts the normal
boundary burst caused by jitter, while a producer that continues materially
above one frame per second exhausts the bucket and is closed with the existing
1008 policy code. Other command and audio limits retain their current behavior.

This is preferable to adding client delay alone, which remains sensitive to
timing variation, and to raising the rolling-window count to two, which would
silently permit a sustained two-frame-per-second stream.

## Extension Feedback

The extension close listener will format the `CloseEvent` code and reason in the
status text. A close with code 1008 and reason `Rate limit exceeded.` will appear
as `Backend connection closed (1008: Rate limit exceeded.)`. When the peer does
not provide useful details, the existing generic message remains the fallback.
No provider errors, credentials, or private media content are exposed.

## Tests

- A frame at the one-second boundary with slight negative jitter is admitted.
- A sustained frame flood still closes the browser WebSocket with code 1008.
- Non-frame rate limits keep their existing fail-closed behavior.
- Close-status formatting includes a supplied code and reason and preserves the
  generic fallback when neither is useful.
- Backend tests, extension tests, and the production extension build must pass.

## Scope

Only the frame admission policy, its regression tests, and extension close
status formatting are changed. Existing uncommitted Gemini Live transcript and
audio-playback work is outside this change and must remain untouched.
