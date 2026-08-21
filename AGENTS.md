# StreamSense Repository Guide for AI Agents

Read this file before changing the repository. Then read
`docs/architecture.md` and the README for the package you will touch.

## Product boundaries

- StreamSense Live is the Chrome extension side panel. It owns tab
  authorization, capture, live narration, questions, interruption, and the
  current-session timeline.
- StreamSense Memory is the browser dashboard. It owns saved-session review,
  search, the chronological timeline, the relationship map, and prototype
  account preferences.
- Clicking the extension toolbar opens the side panel. The side panel's
  **Open Memory Dashboard** action opens the dashboard in a normal Chrome tab.
- The dashboard must not become a second realtime client. It reads bounded REST
  projections from the shared backend.

## Architecture invariants

- Keep microphone audio and captured-tab audio separate. Microphone audio is
  user input; captured-tab audio is commentary context.
- Automatic narration must be grounded in the admitted visual frame, accepted
  into the timeline before speech, and rejected when stale, repeated,
  self-referential, or unsupported.
- Do not change Gemini prompts, VAD, speech policy, media capture, transcript
  handling, or audio playback as a side effect of dashboard/account work.
- SQLite remains the fast local evidence store for accepted realtime events.
  When `MONGODB_URI` is configured, the same real sessions and events are also
  archived asynchronously into MongoDB and become the durable source for the
  Memory dashboard, semantic search, and relationship graph.
- The MongoDB `events` document is shared by chronological history and semantic
  enrichment. History and embedding writers must upsert by the same event ID
  and preserve one another's fields; they must never create two competing
  versions of an event.
- Normal `npm run dev` never injects synthetic dashboard sessions. Memory starts
  from persisted MongoDB history or from an empty in-memory fallback when no
  MongoDB URI is configured. Deterministic fixtures remain test-only.
- Browser account storage contains only an opaque account UUID. Never store
  passwords, API keys, Google credentials, or the full profile there.
- The relationship map hierarchy is Memory → domain → session → event →
  context. Event X is normalized stream progress, Y is supplied importance,
  and Z is the labeled entertainment lane. Structural roots sit before the
  measured plot. The unfiltered overview reserves the five canonical lanes and
  stays 3D; empty lanes are visual scaffolding only and never create API nodes,
  sessions, moments, or relationships. Filtered and session-scoped single-lane
  graphs default to 2D. Every relationship must also be available as readable
  DOM content.

## UI and accessibility

- Reuse extension-owned tokens and shared UI primitives through
  `session-dashboard/src/components/StreamSenseUi.ts`.
- Do not redesign the Chrome extension while making dashboard changes unless
  the task explicitly requests it.
- The dashboard has one accessible default theme. Do not add a dashboard-only
  contrast toggle; retain visible focus, OS forced-colors support, reduced
  motion, semantic landmarks, screen-reader status, and keyboard equivalents.
- Keep the dashboard a bounded desktop workspace with responsive stacking, not
  a stretched marketing page or a copy of side-panel geometry.

## Git and collaboration

- Preserve unrelated user changes and untracked files.
- Use functionality-based branch names without an automatic `codex/` prefix.
- Do not merge or modify another person's branch. Cherry-pick only when the
  user explicitly authorizes the exact source.
- Do not push, open a pull request, or change remote state until the user says
  so explicitly.
- Before committing, review the staged file list, run `git diff --check`, and
  confirm the diff does not cross product boundaries unintentionally.

## Verification

Run focused tests while iterating. Before a final commit, run from the repository
root:

```powershell
npm.cmd run check
```

For MongoDB-backed history/profile work, verify against the configured
development Atlas database. The required end-to-end acceptance is: create a
real Live session, record an event, open that exact session in Memory, restart
the backend, and confirm the same session/event/search/graph data remains.
When intentionally testing the optional offline substitute, also run:

```powershell
docker compose up -d mongodb
```

Never expose a populated `MONGODB_URI`. Teammates must use their own Atlas
project invitation and database user; follow `docs/mongodb-atlas-handoff.md`.

The full check must keep orchestration, backend, extension, and dashboard tests
and builds passing. Record non-blocking warnings separately from failures.

## Documentation

- Update `docs/architecture.md` when component ownership, data flow,
  persistence, or implementation status changes.
- Update the root and package READMEs when setup commands, routes, keyboard
  behavior, storage, or user-facing architecture changes.
- Mark roadmap ideas as future work. Do not document an idea as implemented
  until code and verification support that claim.
