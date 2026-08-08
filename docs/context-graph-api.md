# Context Graph API Contract

`GET /api/context-graph` exposes a bounded, renderer-neutral relationship graph
for the StreamSense Memory dashboard. It is a read model over the configured
history repository. The endpoint does not call Gemini, Cloud Speech-to-Text,
MongoDB, an embedding provider, or Redis by itself.

The Memory dashboard uses the contract on its first page and inside each
session. It presents a native node inspector and optional Three.js map; session
pages also render complete readable DOM node and relationship lists. The API
remains renderer-neutral. The visual layer may position and style supplied
records, but must not infer missing nodes, relationships, confidence, or
semantic scores.

The former `/dashboard/explore` route is only a compatibility redirect. A valid
`sessionId` redirects to that session's `#relationships` section; otherwise it
returns to the Memory overview. An active session opened by the extension uses
`/dashboard/sessions/{sessionId}?source=extension` and refetches this graph over
REST every two seconds. That behavior is polling, not a live graph
subscription.

## Request

```http
GET /api/context-graph?sessionId=&query=&domain=&limit=
Accept: application/json
```

All query parameters are optional:

| Parameter | Contract |
| --- | --- |
| `sessionId` | UUID. Restricts the graph to one existing session. |
| `domain` | Trimmed string, 1–80 characters. Exact case-insensitive session-domain match. |
| `query` | Trimmed string, 1–500 characters. Case-insensitive substring filter over session title, summary, entities, and topics. It is not vector search. |
| `limit` | Integer from 1 to 200; default 80. This is the node limit. |

Without `sessionId`, the current service considers at most 50 sessions. It
loads at most 100 chronological events per included session before applying the
graph bounds. These are service safety limits, not pagination promises.

If `sessionId` does not exist, the endpoint returns `404 SESSION_NOT_FOUND`.

## Response envelope

```json
{
  "meta": {
    "dataOrigin": "demo"
  },
  "nodes": [
    {
      "id": "session:10000000-0000-4000-8000-000000000001",
      "type": "session",
      "label": "Team A vs Team B",
      "sessionId": "10000000-0000-4000-8000-000000000001",
      "metadata": {
        "domain": "football",
        "startedAt": "2026-08-01T12:00:00.000Z"
      }
    }
  ],
  "edges": []
}
```

`meta.dataOrigin` is `demo`, `realtime`, `mixed`, or `empty`, based on the
sessions represented in the response.

The hard response limits are 200 nodes and 600 edges. The current builder also
limits edges to four times the requested node limit, so the effective edge cap
is `min(600, limit * 4)`. It never emits an edge whose source or target node was
excluded by the node limit.

## Nodes

All node IDs and labels are 1–240 characters. IDs are opaque client keys and
must not be decoded to recover labels.

| Type | Meaning | Relevant fields |
| --- | --- | --- |
| `session` | One historical viewing session. | `sessionId`; metadata includes `domain` and `startedAt`. |
| `event` | One archived, timestamped event. | `sessionId`, `eventId`, `importance`; metadata includes display timestamp, numeric timestamp, and event type. |
| `entity` | A normalized entity label shared by one or more events. | Human-readable `label`; ID uses a fixed SHA-256-derived identifier. |
| `topic` | A normalized topic label shared by one or more events. | Human-readable `label`; ID uses a fixed SHA-256-derived identifier. |

Entity and topic labels are compared case-insensitively for their identifier.
The API retains the supplied display label and does not expose the unhashed
identifier input separately.

## Edges and exact weight meanings

Every edge has an opaque `id`, a present `source` node ID, a present `target`
node ID, a `type`, and a finite `weight` from 0 through 1.

| Type | Direction | Weight |
| --- | --- | --- |
| `same_session` | session → event | Exactly `1`. It means direct membership of that archived event in that session. |
| `shared_entity` | event → entity | Exactly `1`. It means the event contains that normalized entity label. Multiple events can point to the same entity node. |
| `shared_topic` | event → topic | Exactly `1`. It means the event contains that normalized topic label. Multiple events can point to the same topic node. |
| `temporal_relation` | previous event → next event in the same session | `round3(1 / (1 + elapsedSeconds / 60))`, where `elapsedSeconds = max(0, next.timestampSeconds - previous.timestampSeconds)`. Consecutive events at the same timestamp have weight `1`; the weight decays as their gap grows. |
| `semantic_similarity` | event ↔ event relationship supplied by a future semantic integration | Reserved and optional. A future adapter may provide a normalized similarity score from 0 through 1. The current builder emits no such edges. It omits them rather than inventing a score. |

`round3` means rounding to three decimal places. A non-semantic edge weight is
structural; it must not be presented as model confidence or probability.

Before emitting `semantic_similarity`, an integration must define stable pair
identity, normalize provider-specific scores to `[0, 1]`, apply its own bounded
threshold/ranking policy, and include only event nodes already admitted to the
graph. This contract deliberately does not define provider, embedding, MongoDB,
or Redis internals; those remain behind the durable integration boundary.

## Ordering and truncation

The in-memory repository supplies sessions newest-first and events in ascending
`timestampSeconds`, with stable ID tie-breakers. The graph builder walks those
bounded inputs in order. When the node or edge limit is reached, later
relationships are omitted. Clients must treat arrays as a bounded projection,
not a complete database export.

## Dashboard presentation semantics

After Zod validation, the dashboard builds a deterministic scene model from the
supplied arrays. It deduplicates IDs, omits dangling edges whose endpoint is not
present, and preserves stable ordering.

### Position uses semantic measurements

The scene follows one stable hierarchy: StreamSense Memory, entertainment
domain, session, event, then entity/topic context. The Memory, domain, and
session roots are derived layout scaffolding placed before the measured event
region; they are not assigned invented progress or importance values.

Event coordinates are deterministic and inspectable:

- X is normalized stream progress from 0–100%. Session duration is the primary
  denominator; active or duration-less sessions fall back to the latest
  recorded event. Exact timestamps remain in node details.
- Y is the supplied event `importance`. A missing value occupies a labeled
  **Not scored** band rather than a fabricated midpoint.
- Z is the categorical entertainment lane: Sports, Esports and games,
  Concerts, Product launches, Creator livestreams, or Other entertainment.
  Multiple sessions use narrow stable sub-lanes inside that band.

Entity and topic coordinates are weighted centroids of their connected events,
with small deterministic offsets solely to keep coincident spheres separable.
Multi-domain context uses the midpoint of the lanes it actually connects and
retains the pearl surface. Visual proximity without a supplied edge is never a
relationship.

The unfiltered dashboard overview reserves five canonical domain lanes and
defaults to the oblique 3D overview. Reserved empty lanes are renderer-only
scaffolding: they create no API node, edge, session, event, coordinate, or
relationship. Unclassified supplied history adds a sixth Other entertainment
lane. A domain filter or session-scoped response remains data-driven and, with
one lane, defaults to the honest progress × importance 2D projection and
disables orbit. Fixed buttons restore **3D
overview**, **Progress × importance**, **Progress × entertainment**, or
**Importance × entertainment** as applicable.

### All-sphere node semantics

Every node uses the same sphere geometry. Color identifies entertainment
domain, while surface, halo, size, labels, and DOM details convey role so
meaning does not depend on color alone.

| Node type | Sphere role and size meaning |
| --- | --- |
| Derived Memory root | Largest luminous sphere; layout scaffolding rather than an API node. |
| Derived domain root | Second-largest colored lane root; layout scaffolding rather than an API node. |
| `session` | Medium fixed-size structural anchor with a double halo. |
| `event` | Filled sphere; radius represents supplied `importance`, not confidence or similarity. |
| `entity` | Wireframe sphere; radius represents the number of supplied connections to events, capped for display. |
| `topic` | Translucent sphere; radius represents the number of supplied connections to events, capped for display. |

### Edge semantics

Structural edge types retain the exact meanings defined above. Session and
temporal relationships form the persistent overview skeleton. Entity, topic,
and semantic links are hidden until their endpoint is selected, reducing edge
crossings without removing them from the DOM alternative. Shared-topic and
semantic relationships retain distinct dashed treatments. When the backend
omits a relationship, the client does not calculate or fabricate one.

The WebGL renderer adds the luminous Memory and domain roots, semantic rulers,
and faint Memory-to-domain and domain-to-session hierarchy guides. These are
layout scaffolding, not records in `nodes` or `edges`. They never appear as a
supplied relationship and are described separately in the visual legend.

Projected labels are priority-bounded and collision checked after every CSS2D
render. Memory and domain roots carry the default overview; individual session,
event, entity, and topic labels are disclosed on hover or selection. Each
entertainment lane has a faint colored progress-by-importance grid, making the
categorical Z separation visible without inventing a continuous score. First-hop
spheres and edges still brighten on selection, but connected labels are not all
forced onscreen. This prevents a dense session from replacing the graph with
overlapping text.

The multi-domain canvas supports pointer orbit and sphere selection, with
visible semantic projection, reset, and zoom buttons. Single-lane 2D views do
not offer orbit. The canvas is never the only access path. A labeled grouped
node selector, selected-node semantic coordinates, first-hop relationship
sentences, session/event links, legends, and status text appear below the
full-width canvas. Session pages continue with complete readable node and
relationship lists.

`Alt+G` focuses the labeled selector, and the dashboard also exposes visible
shortcut help. One stable accessible theme covers both the DOM details and
WebGL scene; there is no separate dashboard contrast mode.
`prefers-reduced-motion` disables camera easing and minimizes CSS motion. If
WebGL initialization fails, the dashboard reports the optional view as
unavailable and leaves the DOM path usable. Forced-colors styles preserve
visible focus and graph legends.

The renderer schedules bounded frames only for initialization, interaction,
selection, and resize. Replacing graph data or leaving the route cancels the
pending frame, removes listeners and labels, disconnects resize observation,
and disposes controls, geometries, materials, and the WebGL renderer.

## Errors and availability

Errors use the standard uppercase envelope:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "limit: Too big: expected number to be <=200"
  }
}
```

Possible graph-route codes are `INVALID_REQUEST`, `SESSION_NOT_FOUND`,
`API_NOT_FOUND`, or `HISTORY_UNAVAILABLE`. A graph error is recoverable in the
dashboard and does not make the session list or chronological timeline
unavailable.

## Integration boundary

The context graph consumes `HistoryService` repository results only. Durable
MongoDB history, vector retrieval, Redis current context, retrieval ranking,
and optional semantic edges are not supplied by the current in-memory
composition. The handoff for
those pieces is documented in
[`semantic-history-integration.md`](semantic-history-integration.md).

This endpoint is independent of the realtime Cloud Speech-to-Text path; the
dashboard feature did not alter that architecture.
