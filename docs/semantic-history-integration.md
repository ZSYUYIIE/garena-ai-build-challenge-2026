# Semantic History Integration Handoff

This document defines the narrow integration boundary between the
session-dashboard work and Anson's durable retrieval work. The dashboard branch
owns the REST/UI contract, deterministic demo adapter, in-memory history
repository, and context-graph read model. Anson owns:

- durable MongoDB session and event storage;
- vector embedding generation and vector search;
- Redis current-session context;
- retrieval filtering, ranking, thresholds, and production score calibration.

Those durable integrations are not implemented or proven on this branch. The
boundary exists so they can be added without giving the React client database
or provider knowledge.

## Semantic search interface

Implement a subclass or compatible object for
`SemanticHistoryService.searchSimilarEvents(input)`:

```js
class DurableSemanticHistoryService extends SemanticHistoryService {
  async searchSimilarEvents({ query, sessionId, domain, limit }) {
    return {
      dataOrigin: "realtime",
      retrievalMode: "semantic",
      results: [],
    };
  }
}
```

The input has already passed strict validation:

| Field | Contract |
| --- | --- |
| `query` | Trimmed string, 2–500 characters. |
| `sessionId` | Optional UUID. When present, include results only from that session. |
| `domain` | Optional trimmed string, 1–80 characters. Apply as a case-insensitive logical domain filter. |
| `limit` | Integer 1–50; default 10. Never return more than this many results. |

The adapter must return an object with:

```json
{
  "dataOrigin": "realtime",
  "retrievalMode": "semantic",
  "results": [
    {
      "sessionId": "10000000-0000-4000-8000-000000000001",
      "sessionTitle": "Team A vs Team B",
      "eventId": "20000000-0000-4000-8000-000000000001",
      "timestampSeconds": 222,
      "timestamp": "03:42",
      "eventType": "shot_saved",
      "description": "The goalkeeper saves a close-range shot.",
      "entities": ["Team A", "Player 9"],
      "topics": ["Close-range opportunity"],
      "similarity": 0.88
    }
  ],
  "warning": "Optional bounded warning text."
}
```

Each result is validated strictly. `sessionTitle` and `warning` are optional;
`similarity` is a finite normalized score from 0 through 1 or `null` when the
retrieval mode has no meaningful comparable score. Descriptions, labels, and
arrays remain bounded by the schemas in
`ai-voice-realtime/src/history/historySchemas.js`.

The adapter owns the meaning and calibration of similarity. Do not expose raw
provider distance if lower values mean “more similar”; normalize it before
returning the contract. Apply `sessionId` and `domain` filters before the final
limit, and use a deterministic tie-breaker so repeated calls are stable.

## Dependency injection

Construct the durable adapter in the backend process bootstrap and pass it as
`semanticHistoryService`:

```js
const semanticHistoryService = new DurableSemanticHistoryService(/* owned dependencies */);

const runtime = createStreamSenseServer({
  /* existing realtime configuration */
  historyRepository,
  semanticHistoryService,
});
```

`createStreamSenseServer` supplies the adapter to `HistoryService`. The REST
router calls `HistoryService.searchSimilarEvents`; the React client remains
unchanged and continues to call `POST /api/search`.

Keep the storage boundary separate:

- a durable history implementation should satisfy `HistoryRepository`
  (`upsertSession`, `archiveEvent`, `listSessions`, `getSession`,
  `listSessionEvents`, and `close`);
- the semantic adapter handles retrieval, not session CRUD;
- Redis/current-context state must not become a required dependency for listing
  already archived sessions;
- the dashboard must never receive database credentials, provider keys,
  embeddings, or Redis connection details.

No merge of provider-specific code into the demo adapter is required. Inject a
different implementation at composition time.

## Modes and data origin

Current process composition uses:

| Mode | Repository | Semantic adapter | Restart behavior |
| --- | --- | --- | --- |
| `STREAMSENSE_HISTORY_MODE=memory` (default) | Empty in-memory repository | `UnavailableSemanticHistoryService` | All dashboard history is lost. |
| `STREAMSENSE_HISTORY_MODE=demo` | Deterministically seeded in-memory repository | `DemoSemanticHistoryService` | Fixture resets; production mode refuses startup. |
| Future durable composition | Anson-owned repository | Anson-owned semantic adapter | Must be defined and tested by that integration. |

`dataOrigin` describes the records actually returned, not the environment name:

- `demo` for deterministic fixture records;
- `realtime` for records archived from realtime sessions;
- `mixed` when an aggregate response contains both;
- `empty` when no records/results contribute an origin.

Do not label durable or provider-backed data as `demo`, and do not label fixture
data as `realtime`.

The dashboard response schema also understands `retrievalMode: "text"` for a
future bounded lexical fallback. The current backend composition produces
`semantic` from the deterministic adapter or `unavailable` from the default
adapter. If Anson introduces `text`, update and test `HistoryService` mapping at
the same time rather than silently relabeling it.

## Failure contract

Semantic retrieval is optional. If the adapter is absent, throws, times out, or
returns invalid result records, `HistoryService` contains that failure and
returns a successful degraded response:

```json
{
  "meta": { "dataOrigin": "empty" },
  "results": [],
  "retrievalMode": "unavailable",
  "warning": "Similar moments are temporarily unavailable. Session history is still available."
}
```

This failure must not break `GET /api/sessions`, session detail, chronological
events, or the context graph. Operational reporting should be sanitized: do not
log API keys, connection strings, embeddings, private queries, transcript text,
or full provider payloads.

Set explicit provider timeouts and cancellation at the durable adapter boundary.
`HistoryService` contains rejected promises, but it does not define Anson's
network timeout or retry budget.

## Optional semantic graph edges

The context-graph schema reserves `semantic_similarity`, but the current graph
builder deliberately emits none. An Anson-owned integration may add such edges
only from bounded, verified event-pair scores normalized to `[0, 1]`. If no
score is available, omit the edge rather than fabricate a relationship. See
[`context-graph-api.md`](context-graph-api.md) for exact structural edge
weights and graph limits.

## Integration verification checklist

Before enabling durable composition, verify with test doubles and the chosen
services that:

1. session and domain filters are applied before limiting;
2. result order is stable and scores are normalized;
3. malformed/stale vector records are rejected without breaking history CRUD;
4. empty, timeout, and provider-error paths return `retrievalMode: unavailable`;
5. pagination remains bounded and chronological for repository events;
6. repository writes are idempotent under archive retries;
7. restarts retain only data intended to be durable;
8. logs and browser responses contain no credentials, embeddings, raw provider
   payloads, or private transcript text;
9. context-graph semantic edges are bounded, normalized, and omitted when not
   supported.

The history adapter boundary does not own Cloud Speech-to-Text lifecycle, audio
routing, or provider credentials. The dashboard's no-STT demo is not evidence
of physical Chrome, Gemini, or Cloud Speech-to-Text acceptance.
