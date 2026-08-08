# StreamSense Memory Dashboard

The dashboard is StreamSense's accessible Memory surface. Clicking the Chrome
toolbar icon always opens the compact Live side panel; it never opens Memory
directly. Capture, narration, questions, and interruptions remain there. A
separate **Open Memory Dashboard** option inside that panel starts the handoff.
Both surfaces use the same local backend, but Memory consumes only bounded REST
endpoints. It never calls Gemini, MongoDB, an embedding provider, Redis, Cloud
Speech-to-Text, or the realtime WebSocket directly; account REST endpoints let
the backend mediate the MongoDB profile collection.

After the protocol-v2 handshake, the backend gives Live the actual session
UUID. **Open Memory Dashboard** then opens:

```text
/dashboard/sessions/{sessionId}?source=extension
```

If no session is active, the action opens
`/dashboard/?source=extension`. The active-session URL refetches the session,
event timeline, and relationship graph over REST every two seconds while the
page is open. This is periodic REST refresh, not a live subscription: capture
and controls remain in the extension, updates can arrive after archival delay,
and a backend restart still clears the in-memory Memory projection.

Use the repository-root npm workspace for installation and integrated commands.
`npm run dev` starts the shared backend on `8000`, the Live extension process on
`5173`, and this Memory application on `5174`; the side panel's Memory Dashboard
action targets the latter. `npm run dev:dashboard` omits the extension and uses
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

Account preferences use the backend's configured MongoDB Atlas connection.
Copy `ai-voice-realtime/.env.example` to the ignored backend `.env`, then place
the Atlas Drivers SRV value in `MONGODB_URI`. A dedicated Atlas database user is
separate from the MongoDB Cloud sign-in. For offline development only, start
`docker compose up -d mongodb` and use `mongodb://localhost:27017` instead.

`start:dashboard-demo` is development-only and is refused when
`NODE_ENV=production`. It seeds a fresh in-memory repository during backend
startup. Restarting the process resets the same deterministic sessions.

Normal backend startup (`npm start`, or `STREAMSENSE_HISTORY_MODE=memory`) uses
an empty in-memory history repository. Realtime sessions may populate it, but
both memory and demo history disappear when the backend restarts. Durable
session/event storage, vector embeddings/search, Redis current context, and
retrieval ranking remain separate integration work. Dashboard profiles use a
separate MongoDB collection and survive backend restarts.

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

## Routes and Live handoff

- `/dashboard/` — Memory-first overview with the relationship map before page
  metrics and recent sessions
- `/dashboard/sessions/:sessionId` — metadata, summary, a session-scoped
  relationship map and readable lists, then the chronological event timeline
- `/dashboard/search` — natural-language historical search
- `/dashboard/account` — a MongoDB-backed prototype profile and dashboard preferences
- `/dashboard/explore` — legacy compatibility redirect, not a separate page

`/dashboard/explore?sessionId={validUuid}` redirects to
`/dashboard/sessions/{validUuid}#relationships`. If `source=extension` is the
single valid source value it is preserved on that redirect. A missing or
invalid session ID returns to the Memory overview, again preserving the valid
extension source marker. New navigation should link to Memory or a session
directly.

## Prototype dashboard account

The Account route creates a profile containing display name, normalized email,
primary entertainment preference, preferred narration detail, UUID, and
timestamps. The dashboard validates the response from `/api/accounts`; the
backend validates the request again and stores it in MongoDB collection
`dashboard_accounts`. Unique indexes protect both `accountId` and normalized
email. Browser local storage contains only `{ version: 2, accountId }` under
`streamsense.dashboard.account.v2`.

This is not password authentication and it does not partition the shared
in-memory history repository or pass preferences into the live extension.
Signing out only forgets the UUID on that browser; it does not delete the
MongoDB record. A production identity provider, recovery flow, deletion API,
and per-user history ownership remain later backend work.

## Relationship-map semantics

The overview leads with the bounded graph returned by
`GET /api/context-graph`. A domain filter can focus the constellation, and each
session repeats the same component with that session ID. The client validates,
deduplicates, and renders only supplied nodes and edges; it does not infer
missing relationships or semantic scores.

This is a measured memory hierarchy:
`StreamSense Memory -> entertainment domain -> session -> chronological event
-> entity/topic`. The Memory root is the largest luminous sphere, followed by
progressively smaller domain, session, event, and context spheres. Memory,
domain, and session roots sit before the measured plot and never receive fake
data coordinates.

Event X is normalized stream progress from 0–100%, Y is supplied importance,
and Z is the labeled entertainment lane. Session duration supplies the progress
denominator; active sessions fall back to their latest recorded event. Missing
importance uses a visible **Not scored** band. Multiple sessions use bounded
sub-lanes within their domain. Entity/topic positions derive from connected
event centroids, while cross-domain context sits between the lanes it connects.

While **All domains** is selected, the overview reserves Sports, Esports and
games, Concerts, Product launches, and Creator livestreams and defaults to an
oblique 3D view. Empty lanes say **No saved sessions** and create no fake API
nodes, sessions, moments, coordinates, or relationships. Actual unclassified
history retains a sixth **Other entertainment** lane. Explicit domain filters
and session-scoped maps remain data-driven and default to the honest progress ×
importance 2D view when only one lane is present. Semantic camera buttons
restore **3D overview**, **Progress × importance**, **Progress ×
entertainment**, and **Importance × entertainment** when those dimensions are
available.

Every node uses sphere geometry. Meaning is deliberately not color-only:

| Role | Sphere treatment and size meaning |
| --- | --- |
| Memory root | Largest luminous sphere; derived hierarchy scaffold rather than an API node. |
| Domain root | Second-largest colored lane root; derived from session metadata. |
| Session | Medium structural anchor with a double halo. |
| Event | Filled sphere; radius represents supplied event importance. |
| Entity | Wireframe sphere; radius represents its supplied event-connection count. |
| Topic | Translucent sphere; radius represents its supplied event-connection count. |

Sphere color groups content into Sports, Esports and games, Concerts, Product
launches, Creator livestreams, or Other entertainment. A pearl node marks a
context label connected across more than one domain. The legend names every
domain and role.

Edges preserve the API contract: session membership, next event in time,
shared entity, shared topic, and optional backend-supplied semantic similarity.
Session membership and chronology form the persistent skeleton. Entity, topic,
and semantic links stay hidden until selection, then the selected sphere and its
first-hop supplied connections brighten while unrelated content dims. Connected
labels are not forced onscreen. Memory and domain roots carry the default
overview; individual node labels appear on hover or selection and pass through
screen-space collision suppression. Faint colored progress-by-importance grids
make the categorical entertainment lanes legible in depth. The readable
inspector retains every first-hop relationship.

The renderer also draws semantic rulers plus faint Memory-to-domain and
domain-to-session guides. These derived elements explain hierarchy but are not
added to the backend graph contract or supplied-edge legend.

Visible introduction copy is intentionally compact: session count, moment
count, and populated-lane count plus the four headings Memory, Domains,
Sessions, and Moments and context. The complete axis and layout description is
kept as the canvas text alternative and repeated in the readable details below.

The hierarchy and focus behavior are informed by the
[Cone Trees hierarchy research](https://doi.org/10.1145/108844.108883), the
empirical priority of
[reducing edge crossings](https://doi.org/10.1007/3-540-63938-1_67), and
[3D network perception research](https://scholars.unh.edu/ccom/182/). The
summary, below-canvas node details, and relationship lists follow the W3C guidance for
[complex-image text alternatives](https://www.w3.org/WAI/tutorials/images/complex/).

## Shared extension design system

The dashboard imports the Chrome extension's real Tailwind theme and UI
primitives through `src/components/StreamSenseUi.ts`. Buttons, inputs, labels,
selects, typography, color tokens, and focus states therefore have one source
of truth. Dashboard CSS is limited to the wider page
layout, content-specific cards, accessibility states, and the WebGL canvas.
Extension feature components are not imported because they own Chrome capture
and realtime state. No extension source or visual design is modified by the
dashboard integration.

## Accessibility controls and alternatives

Every route uses semantic headings and landmarks. Timeline events remain normal
DOM text in an ordered list. The application includes a skip link, visible
keyboard focus, route-change focus management, explicit loading/error/empty
states, and status announcements.

The dashboard exposes these shortcuts and matching visible controls:

| Shortcut | Action |
| --- | --- |
| `Ctrl+K` | Open and focus Memory search. |
| `Alt+H` | Open the Memory overview. |
| `Alt+G` | Focus the map's labeled-node selector. |
| `Alt+/` | Open or close shortcut help. |
| `Escape` | Close open shortcut help and restore focus. |

The dashboard uses one extension-derived theme rather than a persisted visual
mode. Contrast, borders, text, and focus treatment are part of the default
design. The stylesheet still respects the operating system's forced-colors
mode. Shortcuts never replace standard Tab navigation.

Pointer users can orbit the multi-domain view, zoom, and select spheres.
Visible buttons restore named semantic projections and reset framing. The
single-lane 2D view disables orbit. Keyboard and assistive-technology
users can select every labeled node in a labeled, grouped control, inspect its
role, domain, size meaning, and first-hop relationships, and follow its
session/event link. The selector, selected-node details, and legends sit below
the full-width canvas rather than in a scrolling side inspector. Session pages
continue with complete readable node and relationship lists.

`prefers-reduced-motion` disables camera easing and minimizes CSS animation and
transitions. If WebGL cannot start, the app reports the optional visual view as
unavailable while preserving the selector and DOM information.

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
These features and checks support accessibility work but do not by themselves
constitute a formal WCAG conformance audit.

The dashboard work did not change the Cloud Speech-to-Text architecture. These
automated and local demo workflows do not constitute physical Chrome, Gemini,
or Cloud Speech-to-Text provider acceptance.
