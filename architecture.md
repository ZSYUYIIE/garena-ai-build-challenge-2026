# StreamSense Architecture Compatibility Entry

The former root-level architecture snapshot has been retired because it
duplicated current guides and drifted after changes to Chrome timeline TTS,
Deep Research, MongoDB profiles/context copies, and the Memory dashboard.

Use these maintained references instead:

- [`docs/architecture.md`](docs/architecture.md) — current component ownership,
  data flow, persistence, accessibility, and product direction.
- [`docs/README.md`](docs/README.md) — documentation authority and index.
- [`chrome-extension/README.md`](chrome-extension/README.md) — Live extension,
  capture, narration, answers, and Memory handoff.
- [`ai-voice-realtime/README.md`](ai-voice-realtime/README.md) — backend
  configuration, providers, storage, degradation, and APIs.
- [`session-dashboard/README.md`](session-dashboard/README.md) — Memory routes,
  accounts, REST contracts, relationship map, and accessibility.

Git history preserves the retired detailed snapshot when historical comparison
is necessary. Do not update this compatibility entry with runtime details;
update the canonical or package-specific guide that owns the changed contract.
