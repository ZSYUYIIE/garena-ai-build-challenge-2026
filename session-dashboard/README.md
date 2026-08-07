# StreamSense Session Dashboard

The session dashboard is the accessible history surface for previous
StreamSense viewing sessions. It is intentionally separate from the compact
realtime Chrome side panel and consumes only bounded history REST endpoints.
It never calls Gemini, MongoDB, an embedding provider, Redis, Cloud
Speech-to-Text, or the realtime WebSocket directly.

There is no repository-root `package.json`. Run dashboard commands from
`session-dashboard` and backend commands from `ai-voice-realtime`.

## Run the deterministic demo

This workflow does not require the Chrome extension, a Gemini API key, Google
Cloud ADC, or a working Speech-to-Text provider.

Terminal 1, from the repository root:

```bash
cd ai-voice-realtime
npm install
npm run start:dashboard-demo
```

Terminal 2:

```bash
cd session-dashboard
npm install
npm run dev
```

Open `http://127.0.0.1:5174/dashboard/`. Vite serves the React app on port
`5174` and proxies relative `/api` requests to `http://127.0.0.1:8000`, so
development does not require permissive CORS.

`start:dashboard-demo` is development-only and is refused when
`NODE_ENV=production`. It seeds a fresh in-memory repository during backend
startup. Restarting the process resets the same deterministic sessions.

Normal backend startup (`npm start`, or `STREAMSENSE_HISTORY_MODE=memory`) uses
an empty in-memory history repository. Realtime sessions may populate it, but
both memory and demo history disappear when the backend restarts. Durable
MongoDB storage, vector embeddings/search, Redis current context, and retrieval
ranking remain Anson-owned integration work and are incomplete on this branch.

### Export the fixture without starting the server

```bash
cd ai-voice-realtime
npm run seed:dashboard
```

This writes `ai-voice-realtime/data/dashboard-demo.json`, which is ignored by
Git. Exporting the JSON does not start or populate a backend process, and the
normal server does not load the exported file.

## Serve the built dashboard

Build the frontend before starting the backend:

```bash
cd session-dashboard
npm install
npm run build

cd ../ai-voice-realtime
npm install
npm run start:dashboard-demo
```

Open `http://127.0.0.1:8000/dashboard/`. The backend serves
`session-dashboard/dist` and applies an SPA fallback for `/dashboard/*` routes.
Use `npm start` instead of the final command to view the default empty memory
mode.

## Routes and accessibility

- `/dashboard/` — overview, recent sessions, page metrics, and demo-data notice
- `/dashboard/sessions/:sessionId` — metadata, summary, entities, topics, and a
  chronological event timeline
- `/dashboard/search` — natural-language historical search
- `/dashboard/explore` — accessible context relationships; no Three.js or
  visual-only graph renderer is included

Every route uses semantic headings and landmarks. Timeline events remain normal
DOM text in an ordered list. The application includes a skip link, visible
keyboard focus, route-change focus management, explicit loading/error/empty
states, and reduced-motion behavior.

## REST contract

All requests use the same origin and the relative `/api` prefix.

| Endpoint | Bounds and filters |
| --- | --- |
| `GET /api/sessions?limit=&cursor=` | Default 12, maximum 50; newest sessions first. |
| `GET /api/sessions/:sessionId` | `sessionId` must be a UUID. |
| `GET /api/sessions/:sessionId/events?limit=&cursor=&eventType=&eventId=` | Default 50, maximum 100; chronological. `eventId` supports a bounded deep-link lookup. |
| `POST /api/search` | JSON body: `query` (2–500 characters), optional `sessionId`, optional `domain`, and `limit` (1–50, default 10). Body maximum 16 KB. |
| `GET /api/context-graph?sessionId=&query=&domain=&limit=` | Default 80, maximum 200 nodes. See the graph contract below. |

Cursors are opaque and scoped to their endpoint and filters. Clients must not
decode, alter, or reuse them with another session/filter combination.

Every successful response has a `meta` object:

```json
{
  "meta": {
    "dataOrigin": "demo"
  }
}
```

Current backend values are `demo`, `realtime`, `mixed`, or `empty`. Demo and
mixed results display a persistent text notice.

The list, detail, event, search, and graph envelopes are:

```json
{
  "meta": { "dataOrigin": "realtime" },
  "sessions": [],
  "nextCursor": null
}
```

```json
{
  "meta": { "dataOrigin": "realtime" },
  "session": { "sessionId": "00000000-0000-4000-8000-000000000000" }
}
```

```json
{
  "meta": { "dataOrigin": "realtime" },
  "events": [],
  "nextCursor": null
}
```

```json
{
  "meta": { "dataOrigin": "demo" },
  "results": [],
  "retrievalMode": "semantic",
  "warning": "Optional bounded warning text."
}
```

```json
{
  "meta": { "dataOrigin": "demo" },
  "nodes": [],
  "edges": []
}
```

Session and event objects are strict, bounded records; the abbreviated objects
above show envelope shape rather than complete fixtures. The browser validates
all responses with Zod.

Search `retrievalMode` is `semantic`, `text`, or `unavailable` at the dashboard
contract boundary. The built-in deterministic adapter reports `semantic`; the
default adapter reports `unavailable`. An unavailable or failed semantic
adapter returns HTTP 200 with an empty result list and a human-readable warning,
so session lists, details, and timelines remain usable. `text` is reserved for
a future adapter and is not produced by the current backend composition.

Error responses use stable uppercase codes:

```json
{
  "error": {
    "code": "HISTORY_UNAVAILABLE",
    "message": "StreamSense history is temporarily unavailable."
  }
}
```

The current router can return `INVALID_REQUEST`, `INVALID_CURSOR`,
`INVALID_JSON`, `SESSION_NOT_FOUND`, `API_NOT_FOUND`, `REQUEST_TOO_LARGE`,
`UNSUPPORTED_MEDIA_TYPE`, or `HISTORY_UNAVAILABLE`. User-facing code should
branch on `code`, not parse `message`.

The complete graph semantics are in
[`../docs/context-graph-api.md`](../docs/context-graph-api.md). The durable
semantic adapter handoff is in
[`../docs/semantic-history-integration.md`](../docs/semantic-history-integration.md).

## Verification

```bash
cd session-dashboard
npm run check
```

`npm run check` runs Vitest/Testing Library, TypeScript validation, and the Vite
production build. Tests cover API validation, loading/empty/error states,
chronological rendering, search unavailability, the context-graph boundary,
keyboard entry, route focus, and axe checks. Browser contrast and visible-focus
inspection remain a separate manual acceptance step.

The dashboard work did not change the Cloud Speech-to-Text architecture. These
automated and local demo workflows do not constitute physical Chrome, Gemini,
or Cloud Speech-to-Text provider acceptance.
