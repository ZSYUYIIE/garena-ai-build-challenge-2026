# Smart Narration Speech-Only Gating Verification

## Automated evidence

- Extension unit/integration tests: 229 passed, 0 failed.
- Extension production build and local VAD asset verifier: passed; emitted one
  2,327,524-byte model, one 13,479,978-byte WASM binary, and one 24,180-byte
  runtime module with no remote model/runtime URL.
- Full `npm run check`: passed on 2026-08-21, including orchestration, backend,
  extension tests/build, and dashboard tests/typecheck/build.
- Model SHA-256: `2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f`.

## Physical Chrome acceptance

Record Chrome version, extension commit, media title/URL, result, cancellation
latency, p95 worker inference time, maximum in-flight frames, and whether RMS
fallback occurred. Do not attach or retain captured PCM.

| Scenario | Expected Smart behavior | Result |
| --- | --- | --- |
| Silent video | Narration begins after the existing quiet window. | Not run |
| Instrumental music | Fresh narration can play while music continues at unchanged gain. | Not run |
| Crowd ambience without an identifiable voice | Fresh narration can play after local non-speech stabilizes. | Not run |
| Applause, engines, or impacts | Effects do not create a persistent speech state. | Not run |
| Clean spoken dialogue | Pending narration stays blocked and active narration clears within 200 ms. | Not run |
| Speech over music or crowd noise | Speech blocks or clears narration. | Not run |
| Singing or chanting | Treated conservatively as speech. | Not run |
| Speech pause shorter than 1.25 seconds | Narration remains blocked through both quiet windows. | Not run |
| Voice question during tab audio | The user turn interrupts Chrome TTS and uses the microphone/Gemini path. | Not run |
| Narrate over audio | Existing 40% temporary tab gain remains unchanged. | Not run |
| Narration only | Tab playback remains muted and narration continues. | Not run |
| Worker initialization/inference failure | Confirmed speech stays latched; otherwise RMS fallback activates. | Automated |
| Cloud STT degraded | Chrome TTS continues on the local gate; backend commentary remains degraded. | Not run |

Performance release thresholds are p95 inference at most 16 ms per 32 ms
frame, at most four in-flight frames in a representative ten-minute run (hard
limit eight), no main-thread VAD task over 5 ms, no unbounded heap growth, and
no audio discontinuity.
