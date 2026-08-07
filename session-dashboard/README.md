# StreamSense Session Dashboard

The session dashboard is StreamSense's accessible History surface for previous
viewing sessions. The compact Chrome side panel is the Live surface and opens
this application through **View History**. Both use the same local backend, but
the dashboard consumes only bounded REST endpoints. It never calls Gemini,
MongoDB, an embedding provider, Redis, Cloud Speech-to-Text, or the realtime
WebSocket directly.

Use the repository-root npm workspace for installation and integrated commands.
`npm run dev` starts the shared backend on `8000`, the Live extension process on
`5173`, and this History application on `5174`; the extension's **View History**
button targets the latter. `npm run dev:dashboard` omits the extension and uses
deterministic demo history instead.

## Run the deterministic demo

This workflow does not require the Chrome extension or a realtime provider
session. From the repository root:

```bash
npm install
npm run dev:dashboard
```

Open `http://127.0.0.1:5174/dashboard/`. Vite serves the React app on port
`5174` and proxies relative `/api` requests to `http://127.0.0.1:8000`, so
development does not require permissive CORS. The command supervises exactly
one demo backend and one dashboard Vite process; Ctrl+C stops the profile.

`start:dashboard-demo` is development-only and is refused when
`NODE_ENV=production`. It seeds a fresh in-memory repository during backend
startup. Restarting the process resets the same deterministic sessions.

Normal backend startup (`npm start`, or `STREAMSENSE_HISTORY_MODE=memory`) uses
an empty in-memory history repository. Realtime sessions may populate it, but
both memory and demo history disappear when the backend restarts. Durable
MongoDB storage, vector embeddings/search, Redis current context, and retrieval
ranking remain a separate integration workstream and are not supplied by the
current in-memory composition.

### Export the fixture without starting the server

```bash
npm run seed:dashboard --workspace ai-voice-realtime
```

This writes `ai-voice-realtime/data/dashboard-demo.json`, which is ignored by
Git. Exporting the JSON does not start or populate a backend process, and the
normal server does not load the exported file.

## Serve the built one-backend demo

```bash
npm run demo
```

`demo` builds both the extension and dashboard, then starts exactly one backend
with deterministic in-memory history. Open
`http://127.0.0.1:8000/dashboard/`. The backend serves
`session-dashboard/dist` and applies an SPA fallback for `/dashboard/*` routes;
no Vite server runs in this profile.

## Routes and accessibility

- `/dashboard/` — overview, recent sessions, page metrics, and demo-data notice
- `/dashboard/sessions/:sessionId` — metadata, summary, entities, topics, and a
  chronological event timeline
- `/dashboard/search` — natural-language historical search
- `/dashboard/explore` — readable context relationships plus an optional
  Three.js relationship map

Every route uses semantic headings and landmarks. Timeline events remain normal
DOM text in an ordered list. The application includes a skip link, visible
keyboard focus, route-change focus management, explicit loading/error/empty
states, and reduced-motion behavior.

The 3D explorer is a presentation of the nodes and edges returned by
`GET /api/context-graph`; it does not infer missing relationships. Sessions are
spheres, events are importance-sized cubes, entities are diamonds, and topics
are rings. Structural links use their supplied edge types and optional verified
`semantic_similarity` links are visually distinct; absent semantic scores are
not fabricated.

Pointer users can orbit, zoom, and select shapes. Keyboard and
assistive-technology users can select every labeled node with a native control,
inspect its details, follow the session/event link, and continue to the primary
readable relationship lists. Reduced-motion preference disables ambient
settling motion. If WebGL cannot start, the app reports the unavailable visual
view while leaving the selector and DOM relationships usable.

Rendering is on demand rather than an unbounded animation loop. Changing graph
data or leaving the route cancels pending animation, removes listeners and
labels, disconnects resize observation, and disposes controls, geometries,
materials, and the WebGL renderer.

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
npm run check
```

The root check includes dashboard Vitest/Testing Library tests, TypeScript
validation, and the Vite production build after the orchestration, backend, and
extension gates. Focused dashboard iteration can use
`npm run check --workspace session-dashboard`. Tests cover API validation,
loading/empty/error states, chronological rendering, search degradation, graph
model bounds, renderer fallback/cleanup boundaries, keyboard entry, route
focus, and axe checks. Real-browser WebGL, contrast, visible focus, and
reduced-motion inspection remain separate manual acceptance work.

The dashboard work did not change the Cloud Speech-to-Text architecture. These
automated and local demo workflows do not constitute physical Chrome, Gemini,
or Cloud Speech-to-Text provider acceptance.
