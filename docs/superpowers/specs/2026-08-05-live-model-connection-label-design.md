# Live Model Connection Label Design

**Date:** 2026-08-05

## Goal

Make the extension's connection diagnostic name the Gemini Live model used by the voice session, rather than the separate Gemini vision model.

## Root Cause

After the browser protocol handshake, `ClientSession.acceptHello()` sends a `connected` message whose `model` field is populated from `this.model`. That property identifies the vision model. The side panel renders the same field in its connection status, even though the realtime voice path is configured through `this.liveModel`.

## Chosen Design

Preserve the current protocol shape and UI behavior. Change only the value of the existing `connected.model` field from `this.model` to `this.liveModel`.

The message continues to mean that the browser WebSocket and protocol handshake are connected. Gemini provider readiness continues to be reported separately by the existing provider-health message. Correcting the label must not turn the connection message into a provider-readiness assertion.

## Test Strategy

Use test-driven development:

1. Add a backend session test that configures deliberately different vision and Live model names.
2. Complete the browser hello handshake.
3. Assert that the emitted `connected.model` value equals the Live model name.
4. Confirm that the test fails against the current implementation.
5. Apply the one-line implementation correction and rerun the focused test.
6. Run the complete backend checks, extension tests, and extension production build.

## Compatibility and Risk

There is no message-schema change: clients still receive the existing `model` string. The extension already displays that field without branching on a particular model value. The main compatibility risk is a hidden consumer that interpreted the field as the vision model; that behavior would conflict with the voice connection diagnostic's intended meaning and is not part of the current extension contract.

## Out of Scope

- Changing provider-readiness semantics or UI wording.
- Changing extension-origin policy.
- Configuring Google Cloud Speech-to-Text credentials.
- Replacing the local voice-activity detector.
- Physical Chrome microphone and tab-capture acceptance testing.
