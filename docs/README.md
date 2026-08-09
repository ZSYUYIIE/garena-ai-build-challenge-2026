# StreamSense Documentation Index

This index defines which documents describe the current checkout and which are
historical records. Source, configuration, and fresh verification remain the
final authority when a dated record differs from current behavior.

## Current product and contributor guides

| Document | Authority |
| --- | --- |
| [`../AGENTS.md`](../AGENTS.md) | Repository boundaries, invariants, Git rules, and required verification. |
| [`architecture.md`](architecture.md) | Current cross-package ownership, data flow, persistence, accessibility, and product direction. |
| [`../README.md`](../README.md) | Supported setup, integrated workflows, user behavior, troubleshooting, security, and privacy. |
| [`../chrome-extension/README.md`](../chrome-extension/README.md) | StreamSense Live capture, timeline TTS, answer modes, and Memory handoff. |
| [`../ai-voice-realtime/README.md`](../ai-voice-realtime/README.md) | Backend configuration, provider/storage boundaries, REST surface, and degraded behavior. |
| [`../session-dashboard/README.md`](../session-dashboard/README.md) | StreamSense Memory routes, account profile, graph semantics, REST client, and accessibility. |

The root [`../architecture.md`](../architecture.md) and
[`../agent.md`](../agent.md) files are compatibility entries only. They point
to maintained documents and must not grow independent runtime descriptions.
The backend README also identifies `ai-voice-realtime/static/` as a legacy,
unsupported diagnostic client so it is not mistaken for either product
surface.

## Current focused contracts and handoffs

| Document | Scope |
| --- | --- |
| [`context-graph-api.md`](context-graph-api.md) | Renderer-neutral graph API, bounds, weights, and client presentation semantics. |
| [`semantic-history-integration.md`](semantic-history-integration.md) | Durable history and semantic-search adapter boundary; clearly separates the current realtime MongoDB prototype. |
| [`mongodb-atlas-handoff.md`](mongodb-atlas-handoff.md) | Least-privilege Atlas access, local configuration, and MongoDB data boundaries. |

## Historical records

- [`superpowers/`](superpowers/) contains date-stamped design specs and
  implementation plans. They explain decisions at the time they were written;
  unchecked boxes, old names, old providers, and superseded flows are not
  current status.
- [`verification/2026-08-04-gemini-live-voice-acceptance.md`](verification/2026-08-04-gemini-live-voice-acceptance.md)
  preserves a dated automated/provider evidence snapshot and the still-pending
  physical acceptance matrix. Its metadata identifies the checkout that was
  actually observed.
- [`../sampleui.md`](../sampleui.md) is an early visual concept, not the current
  side-panel specification.

The tracked `.agents/skills/` files are tool instruction packages, not
StreamSense product documentation. Their examples do not override the models,
APIs, or boundaries configured by this repository.

## Maintenance rules

- Update `architecture.md` when ownership, data flow, persistence, or
  implementation status changes.
- Update the root and relevant package READMEs when setup commands, routes,
  labels, shortcuts, storage, or user-visible behavior changes.
- Update focused contracts when their request/response or integration boundary
  changes.
- Add observed evidence to a verification record only after running the named
  command or physical scenario against the identified checkout.
- Keep roadmap ideas explicitly labeled as future work.
- Prefer links to the owning document over copying detailed runtime claims into
  another guide.
