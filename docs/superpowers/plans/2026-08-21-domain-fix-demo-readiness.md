# Domain Fix Demo Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `domain-fix` release candidate reliable for a live hackathon demonstration by removing misleading unknown-domain graph output, making MongoDB semantic retrieval archive-safe, narrowing false-positive narration suppression, and producing real-provider acceptance evidence.

**Architecture:** Keep the three fixes inside their existing product boundaries: dashboard-only graph projection, backend-only MongoDB retrieval/index management, and Live-only deterministic narration validation. Preserve the shared MongoDB event-document invariant, keep Memory REST-only, and close the release with a real Chrome/provider/Atlas acceptance run rather than synthetic data.

**Tech Stack:** React 19, TypeScript, Vitest, Three.js, Node.js 20+, Node test runner, Express, MongoDB Node driver 6.21, MongoDB Atlas Vector Search, Gemini embeddings/vision/Live, Chrome Manifest V3.

**Spec:** `docs/architecture.md` and `docs/scene-description-and-domain-policy.md`

## Global Constraints

- Base all implementation work on commit `39cef9d9f30d5b3d04e615247a23f09a70515760`, the reviewed `domain-fix` tip that already contains `dashboard-semantic`.
- Commit this reviewed plan alone from the current detached checkout, then create a clean linked execution worktree and functionality-named branch such as `demo-readiness-fixes`; do not modify or merge another person's branch.
- Preserve the pre-existing unstaged `package-lock.json` diff in the original worktree. Do not install dependencies or run release gates against that modified lock; the clean execution worktree must use the committed lockfile from `39cef9d`.
- Do not change Gemini prompts, VAD, speech policy, media capture, transcript handling, or audio playback while implementing dashboard or MongoDB fixes.
- Keep microphone audio and captured-tab audio separate.
- Keep Memory bounded and REST-only; do not add a dashboard WebSocket or direct database/provider access.
- Keep SQLite as the required pre-publication evidence store and MongoDB as the asynchronous durable Memory source.
- Keep history and semantic writers on one MongoDB event document keyed by the same event ID.
- Never expose a populated `MONGODB_URI`, API key, extension ID, ADC path, private transcript, or signed-in account information in source, tests, logs, screenshots, or verification records.
- Do not introduce synthetic runtime history. Test fixtures stay test-only; finals history comes from the real Live capture pipeline.
- Keep the unfiltered overview at exactly five canonical 3D lanes. Filtered and session-scoped single-lane graphs stay 2D, and every displayed relationship retains a readable DOM equivalent.
- Keep `SIMILARITY_SCORE_THRESHOLD` at `0.8` unless an independently approved relevance study changes it.
- Run focused tests after each red/green cycle. Before final handoff, run the full repository check, Atlas semantic acceptance, and physical Chrome/provider persistence flow.
- Keep dashboard, backend, and Live changes in separate commits so each product boundary can be reviewed or reverted independently.

## Issue-to-Task Coverage

| Issue | Disposition | Plan task |
| --- | --- | --- |
| Unknown sessions create a populated sixth `Other entertainment` overview lane | Must fix | Task 2 |
| Unknown-domain graph text can still leak through node groups, details, and legends | Must fix | Task 2 |
| `$vectorSearch.limit` runs before `historyArchived: true`, so partial semantic documents can displace valid archived events | Must fix | Task 3 |
| Existing Atlas index lacks `historyArchived` as a filter field | Must fix with an idempotent index-definition upgrade | Task 3 |
| Wrapper guard rejects valid scene-first descriptions containing incidental `video/livestream ... shown` wording | Must fix | Task 4 |
| Atlas semantic path is opt-in and was not exercised by the normal branch check | Must close with unit coverage plus a real Atlas run | Tasks 3 and 6 |
| Required Live → Memory → restart persistence acceptance has not been performed | Release blocker | Task 6 |
| Scene/domain policy is not discoverable from the current documentation index and package READMEs | Must fix | Task 5 |
| Branch spans multiple product boundaries | Control through isolated tasks and commits; do not combine unrelated edits | Tasks 1–5 |
| `0.8` similarity threshold, query-led search, and stale-domain-filter clearing are already fixed | Preserve through existing and new regressions | Tasks 1–3 and 6 |
| Observable backend startup, dev-only extension loading permissions, and no synthetic runtime history are already fixed | Preserve through the full inherited-delta review and repository gate | Tasks 1 and 6 |
| Dashboard build reports an approximately 1.16 MB main JavaScript chunk | Measure on the presentation laptop; treat as non-blocking unless it breaches the explicit interaction target | Task 6 |
| Current worktree contains unrelated lockfile drift | Preserve it in the original worktree and execute from a second clean linked worktree | Tasks 1 and 6 |

## Non-goals

- No new entertainment domains, authentication system, Deep Research behavior, capture cropper, dashboard redesign, or realtime dashboard channel.
- No threshold tuning beyond retaining the existing `0.8` semantic cutoff.
- No automatic Atlas credential provisioning and no broadening Atlas network access.
- No speculative bundle refactor unless the measured presentation-laptop interaction target fails.

---

### Task 1: Isolate the Release Candidate and Record the Baseline

**Files:**
- Inspect only: `package-lock.json`
- Inspect only: `AGENTS.md`
- Inspect only: `docs/architecture.md`
- Inspect only: `session-dashboard/README.md`
- Inspect only: `ai-voice-realtime/README.md`
- Inspect only: `chrome-extension/README.md`

**Interfaces:**
- Consumes: reviewed `domain-fix` tip `39cef9d9f30d5b3d04e615247a23f09a70515760` and this reviewed plan file.
- Produces: a plan-only detached commit, clean linked worktree and branch `demo-readiness-fixes`, a dependency installation from the committed lockfile, and an untouched original worktree containing the pre-existing lockfile drift.

- [ ] **Step 1: Confirm the exact base and linked-worktree state**

Run:

```bash
git rev-parse HEAD
git branch --show-current
git status --short
git diff -- package-lock.json
git merge-base --is-ancestor dev dashboard-semantic
git merge-base --is-ancestor dashboard-semantic domain-fix
git log --first-parent --oneline dev..domain-fix
git diff --name-status dev...39cef9d9f30d5b3d04e615247a23f09a70515760
```

Expected: `HEAD` is `39cef9d9f30d5b3d04e615247a23f09a70515760`; the worktree is detached; `package-lock.json` is already modified and its diff is preserved for comparison; both ancestry checks exit zero; the inherited cross-boundary release inventory is reviewed before adding another commit.

- [ ] **Step 2: Commit only the reviewed plan from the detached checkout**

Run:

```bash
git add docs/superpowers/plans/2026-08-21-domain-fix-demo-readiness.md
git diff --cached --check
git diff --cached
git diff --cached --name-only
git commit -m "docs: plan demo readiness fixes"
```

Expected: the plan is the only committed path, the checkout remains detached at the new plan commit, `domain-fix` remains at `39cef9d`, and the original `package-lock.json` diff remains unstaged.

- [ ] **Step 3: Create a clean linked execution worktree**

Invoke `superpowers:using-git-worktrees` and create a sibling worktree whose branch is `demo-readiness-fixes` and whose base is the detached plan commit. The native Git fallback is:

```bash
git worktree add ../garena-demo-readiness -b demo-readiness-fixes HEAD
```

Expected: the new worktree is on `demo-readiness-fixes`; the original detached worktree still contains the unstaged lockfile drift; `domain-fix` remains unchanged.

- [ ] **Step 4: Install exactly the committed dependencies in the clean worktree**

Run from `../garena-demo-readiness` (or the path selected by the worktree skill):

```bash
git status --short
git diff 39cef9d9f30d5b3d04e615247a23f09a70515760 -- package-lock.json
npm ci
git status --short
```

Expected: both status checks are clean, the lockfile has no diff from `39cef9d`, and installation succeeds without changing tracked files.

- [ ] **Step 5: Prove finals mode fails closed before provisioning ignored secrets**

Run only while both ignored backend environment files are absent in the clean worktree:

```bash
test ! -e ai-voice-realtime/.env
test ! -e ai-voice-realtime/.env.local
MONGODB_URI= STREAMSENSE_HISTORY_MODE=mongodb npm run demo
```

PowerShell equivalent:

```powershell
$env:MONGODB_URI=''
$env:STREAMSENSE_HISTORY_MODE='mongodb'
npm.cmd run demo
```

Expected: the command exits non-zero with a credential-free actionable MongoDB configuration error before binding port 8000; `lsof -nP -iTCP:8000 -sTCP:LISTEN` (or `Get-NetTCPConnection -LocalPort 8000`) finds no new backend listener. If either `test` command fails, do not rename, delete, or edit the environment file; stop and perform this check in a newly clean worktree instead.

- [ ] **Step 6: Run the focused pre-change suites to establish a baseline**

Run:

```bash
npm test --workspace session-dashboard -- src/test/graphModel.test.ts src/test/ThreeGraphExplorer.test.tsx src/test/domainPresentation.test.tsx
node --test ai-voice-realtime/test/sceneDescriptionPolicy.test.js ai-voice-realtime/test/sceneDescriptionClientSession.test.js ai-voice-realtime/test/mongoSemanticHistoryService.test.js
```

Expected: the current tests pass, demonstrating that the new regression cases in Tasks 2–4—not unrelated baseline failures—drive the changes.

---

### Task 2: Make Unknown-Domain Graph Presentation Honest

**Files:**
- Modify: `session-dashboard/src/features/context/graphModel.ts`
- Modify: `session-dashboard/src/features/context/ThreeGraphExplorer.tsx`
- Modify: `session-dashboard/src/features/context/threeGraphRenderer.ts`
- Test: `session-dashboard/src/test/graphModel.test.ts`
- Test: `session-dashboard/src/test/ThreeGraphExplorer.test.tsx`
- Test: `session-dashboard/src/test/domainPresentation.test.tsx`

**Interfaces:**
- Consumes: backend-supplied `GraphNode[]`, `GraphEdge[]`, and existing `GraphSceneScope`.
- Produces: `buildGraphSceneModel(nodes, edges, { scope })` with exactly five canonical overview lanes, no overview node whose only domain key is `unclassified`, and a 2D session-scoped fallback that says `Domain unavailable` without exposing `unknown`, `unclassified`, or `Other entertainment`.
- Produces: intentionally omitted overview edges that are not reported as malformed dangling edges.

- [ ] **Step 1: Replace the sixth-lane expectation with failing overview regressions**

In `graphModel.test.ts`, replace the current test named `keeps unclassified history in a sixth truthful overview lane` with these cases:

```ts
it("omits unclassified records from the five-lane overview", () => {
  const unknown = sessionNode({ domain: "unknown" });
  const model = buildGraphSceneModel([unknown], [], {
    scope: "all-domains-overview",
  });

  expect(model.domains.map((domain) => domain.key)).toEqual([
    "sports",
    "esports",
    "concerts",
    "product-launches",
    "creator-streams",
  ]);
  expect(model.nodes).toEqual([]);
  expect(model.edges).toEqual([]);
  expect(model.droppedDanglingEdgeIds).toEqual([]);
});

it("keeps known overview relationships while omitting an unknown session subgraph", () => {
  const known = sessionNode();
  const unknown = sessionNode({
    id: "session:unknown",
    sessionId: "77777777-7777-4777-8777-777777777777",
    domain: "unknown",
  });
  const knownEvent = eventNode({ id: "event:known", timestampSeconds: 10 });
  const unknownEvent = eventNode({
    id: "event:unknown",
    sessionId: "77777777-7777-4777-8777-777777777777",
    timestampSeconds: 10,
  });
  const model = buildGraphSceneModel(
    [known, unknown, knownEvent, unknownEvent],
    [
      edge("edge:known", known.id, knownEvent.id),
      edge("edge:unknown", unknown.id, unknownEvent.id),
    ],
    { scope: "all-domains-overview" },
  );

  expect(model.nodes.map((node) => node.id)).toEqual([known.id, knownEvent.id]);
  expect(model.edges.map((item) => item.id)).toEqual(["edge:known"]);
  expect(model.domains).toHaveLength(5);
  expect(model.droppedDanglingEdgeIds).toEqual([]);
});
```

Add two more projection cases:

```ts
it("recomputes shared context from only the retained canonical subgraph", () => {
  // One topic is supplied by a sports event and an unknown-session event.
  // The projected overview retains the topic and sports edge only.
  expect(topic.domainKeys).toEqual(["sports"]);
  expect(topic.connectionCount).toBe(1);
  expect(model.edges.map((item) => item.id)).toEqual([
    "edge:known-session",
    "edge:known-topic",
  ]);
});

it("distinguishes malformed edges from intentionally projected edges", () => {
  expect(model.droppedDanglingEdgeIds).toEqual(["edge:missing-endpoint"]);
  expect(model.droppedDanglingEdgeIds).not.toContain("edge:unknown-topic");
});
```

The unknown fixture in these tests must include a session, event, context node, and their supplied edges so a whole unknown-only subgraph—not merely a session sphere—is exercised.

- [ ] **Step 2: Add failing session-scope accessibility coverage**

Add an unknown session plus event/edge fixture to `ThreeGraphExplorer.test.tsx` and assert:

```ts
expect(harness.getOptions()?.model.projectionMode).toBe("two-dimensional");
expect(harness.getOptions()?.model.nodes).toHaveLength(2);
expect(harness.getOptions()?.model.edges).toHaveLength(1);
expect(screen.getByText("Domain unavailable")).toBeInTheDocument();
expect(screen.queryByText(/other entertainment/i)).not.toBeInTheDocument();
expect(screen.queryByText(/^unknown$/i)).not.toBeInTheDocument();
expect(screen.queryByText(/^unclassified$/i)).not.toBeInTheDocument();
expect(screen.getByLabelText("Labeled graph node")).toBeEnabled();
```

Update `domainPresentation.test.tsx` so `/api/context-graph` returns the real unknown session node, one event, and their supplied edge instead of empty arrays. Split the assertions by route:

- Memory home keeps the unknown session card, projects none of that session's graph nodes/edges into the five canonical overview lanes, and exposes none of the three forbidden labels.
- The exact session page keeps both nodes, the supplied edge, the labeled selector, and `RelationshipList` text under `Domain unavailable`, while exposing none of the three forbidden labels.

- [ ] **Step 3: Run the new tests and verify the current implementation fails for the intended reasons**

Run:

```bash
npm test --workspace session-dashboard -- src/test/graphModel.test.ts src/test/ThreeGraphExplorer.test.tsx src/test/domainPresentation.test.tsx
```

Expected: failure shows a sixth `unclassified`/`Other entertainment` lane and user-facing unknown-domain text.

- [ ] **Step 4: Separate internal fallback placement from overview presentation**

In `graphModel.ts`, retain an internal fallback style for session-scoped layout but give it an honest absence label:

```ts
const UNCLASSIFIED_DOMAIN_STYLE: DomainStyle = {
  key: "unclassified",
  label: "Domain unavailable",
  color: 0xcbd5e1,
};

const DOMAIN_STYLES: DomainStyle[] = [
  { key: "sports", label: "Sports", color: 0x2dd4bf },
  { key: "esports", label: "Esports and games", color: 0xa78bfa },
  { key: "concerts", label: "Concerts", color: 0xf472b6 },
  { key: "product-launches", label: "Product launches", color: 0xfbbf24 },
  { key: "creator-streams", label: "Creator livestreams", color: 0x60a5fa },
  UNCLASSIFIED_DOMAIN_STYLE,
];
```

Refactor `buildGraphSceneModel` into three explicit phases:

```ts
type ClassifiedGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  domainKeysByNodeId: Map<string, string[]>;
};

function omitUnclassifiedOverviewSubgraphs(
  graph: ClassifiedGraph,
): ClassifiedGraph;
```

The phases must:

1. validate/deduplicate the full supplied graph and record genuinely missing endpoints;
2. classify the validated full graph, keeping nodes with at least one canonical domain key and removing `unclassified` from context that also has a canonical connected domain;
3. omit nodes whose only domain is `unclassified` only when scope is `all-domains-overview` and keep only edges whose two endpoints remain;
4. rebuild `nodeById`, adjacency, session mappings, event groups, placements, context centroids, `connectionCount`, and relationship inputs entirely from the projected nodes/edges;
5. never count intentionally omitted projection edges in `droppedDanglingEdgeIds`.

Build overview `domainStyles` from `CANONICAL_DOMAIN_STYLES` only. In filtered/session scope, allow the internal unclassified style so the session's supplied nodes and edges remain available in 2D.

- [ ] **Step 5: Remove misleading lane copy without removing readable access**

In `ThreeGraphExplorer.tsx`:

- render `Entertainment domain` rather than `Entertainment lane` in selected-node details;
- show `Domain unavailable` only for the session-scoped fallback;
- ensure the five-lane overview legend is derived only from the five canonical `model.domains`;
- keep the labeled node selector and supplied relationship summary available for unknown session pages;
- ensure the overview summary counts only displayed nodes and populated canonical lanes.

If `graphNodeDisplayLabel` in `threeGraphRenderer.ts` receives a generic `StreamSense session` label, keep its fallback honest:

```ts
const domainPrefix = node.domainLabel === "Domain unavailable"
  ? "Saved session"
  : node.domainLabel;
```

- [ ] **Step 6: Run the focused dashboard tests, typecheck, and build**

Run:

```bash
npm test --workspace session-dashboard -- src/test/graphModel.test.ts src/test/ThreeGraphExplorer.test.tsx src/test/domainPresentation.test.tsx
npm run typecheck --workspace session-dashboard
npm run build --workspace session-dashboard
```

Expected: all commands pass; the build may retain the already-known large-chunk warning, which is evaluated in Task 6 rather than hidden.

- [ ] **Step 7: Commit only the dashboard boundary**

Run:

```bash
git add session-dashboard/src/features/context/graphModel.ts session-dashboard/src/features/context/ThreeGraphExplorer.tsx session-dashboard/src/features/context/threeGraphRenderer.ts session-dashboard/src/test/graphModel.test.ts session-dashboard/src/test/ThreeGraphExplorer.test.tsx session-dashboard/src/test/domainPresentation.test.tsx
git diff --cached --check
git diff --cached
git diff --cached --name-only
git commit -m "fix(dashboard): omit unavailable domains from overview graph"
```

Expected: no backend, extension, docs, or `package-lock.json` path is staged.

---

### Task 3: Pre-filter Semantic Search to Durable Archived Events

**Files:**
- Modify: `ai-voice-realtime/src/context-builder/mongo.js`
- Create: `ai-voice-realtime/test/contextMongo.test.js`
- Modify: `ai-voice-realtime/test/mongoSemanticSearch.integration.test.js`
- Modify: `docs/mongodb-atlas-handoff.md`

**Interfaces:**
- Produces: `buildContextVectorSearchPipeline({ sessionId, queryEmbedding, limitK }) -> object[]` for deterministic pipeline tests.
- Produces: `ensureContextVectorIndex(collection, logger) -> Promise<void>` for idempotent create/update behavior.
- Preserves: `getContextDataFromMongo(sessionId, queryEmbedding, limitK) -> Promise<Array>`.
- Requires: vector index `context_embedding_index` with vector field `embedding` and filter fields `sessionId` and `historyArchived`.

- [ ] **Step 1: Write failing pure pipeline tests**

Create `contextMongo.test.js` with these exact pipeline and definition tests:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContextVectorSearchPipeline,
  CONTEXT_VECTOR_INDEX_DEFINITION,
} from "../src/context-builder/mongo.js";

test("vector search prefilters archived events before applying its limit", () => {
  const pipeline = buildContextVectorSearchPipeline({
    sessionId: null,
    queryEmbedding: [0.1, 0.2],
    limitK: 3,
  });

  assert.deepEqual(pipeline[0].$vectorSearch.filter, {
    historyArchived: { $eq: true },
  });
  assert.equal(pipeline[0].$vectorSearch.limit, 3);
  assert.deepEqual(pipeline[2].$match, {
    score: { $gte: 0.8 },
  });
});

test("session-scoped vector search combines archive and session prefilters", () => {
  const pipeline = buildContextVectorSearchPipeline({
    sessionId: "11111111-1111-4111-8111-111111111111",
    queryEmbedding: [0.1, 0.2],
    limitK: 5,
  });

  assert.deepEqual(pipeline[0].$vectorSearch.filter, {
    historyArchived: { $eq: true },
    sessionId: { $eq: "11111111-1111-4111-8111-111111111111" },
  });
});

test("the vector index defines every prefilter field", () => {
  assert.deepEqual(
    CONTEXT_VECTOR_INDEX_DEFINITION.fields.filter((field) => field.type === "filter"),
    [
      { type: "filter", path: "sessionId" },
      { type: "filter", path: "historyArchived" },
    ],
  );
});
```

- [ ] **Step 2: Write failing index lifecycle tests**

Use a small fake collection in `contextMongo.test.js` to cover all three cases:

1. no index exists → `createSearchIndex` receives the complete definition;
2. an existing `vectorSearch` definition matches vector path `embedding`, 768 dimensions, cosine similarity, and both filter fields → no update;
3. an existing definition drifts in index type, vector path, dimensions, similarity, or either filter field → `updateSearchIndex("context_embedding_index", CONTEXT_VECTOR_INDEX_DEFINITION)` is called exactly once for each drift case.

The fake `listSearchIndexes()` must return an object with an async `toArray()` method, matching the installed MongoDB 6.21 driver. Add a fourth case where `listSearchIndexes`, `createSearchIndex`, or `updateSearchIndex` throws an unsupported-Search error: `ensureContextVectorIndex` must resolve, log only sanitized error name/code plus the fixed index name, and leave chronological Mongo history usable. Connection and collection-acquisition failures remain fatal and are not swallowed by this Search-DDL boundary.

- [ ] **Step 3: Run the tests and verify they fail because the pure interfaces and prefilter do not exist**

Run:

```bash
node --test ai-voice-realtime/test/contextMongo.test.js
```

Expected: failure reports missing exports and the absent `historyArchived` vector prefilter/index field.

- [ ] **Step 4: Extract the pipeline and move durability into the vector prefilter**

In `mongo.js`, define:

```js
export const CONTEXT_VECTOR_INDEX_NAME = "context_embedding_index";

export const CONTEXT_VECTOR_INDEX_DEFINITION = Object.freeze({
  fields: [
    {
      type: "vector",
      path: "embedding",
      numDimensions: 768,
      similarity: "cosine",
    },
    { type: "filter", path: "sessionId" },
    { type: "filter", path: "historyArchived" },
  ],
});

export function buildContextVectorSearchPipeline({
  sessionId,
  queryEmbedding,
  limitK,
}) {
  const safeLimit = Math.max(1, Math.min(Number(limitK) || 10, 50));
  const filter = { historyArchived: { $eq: true } };
  if (sessionId) filter.sessionId = { $eq: sessionId };

  return [
    {
      $vectorSearch: {
        index: CONTEXT_VECTOR_INDEX_NAME,
        path: "embedding",
        queryVector: queryEmbedding,
        numCandidates: Math.max(100, 10 * safeLimit),
        limit: safeLimit,
        filter,
      },
    },
    { $addFields: { score: { $meta: "vectorSearchScore" } } },
    { $match: { score: { $gte: SIMILARITY_SCORE_THRESHOLD } } },
    {
      $project: {
        id: 1,
        sessionId: 1,
        timestampSeconds: 1,
        timestamp: 1,
        eventType: 1,
        entities: 1,
        topicLabels: 1,
        description: 1,
        importance: 1,
        confidence: 1,
        score: 1,
      },
    },
  ];
}
```

`getContextDataFromMongo` must aggregate exactly this pipeline. Do not compensate by over-fetching: the correctness requirement is that invalid partial documents never enter the candidate set.

MongoDB requires every prefilter field to be declared as a vector-search `filter` field; keep this aligned with the official [Vector Search prefilter documentation](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-stage/).

- [ ] **Step 5: Make index initialization idempotently upgrade the existing Atlas index**

Implement `ensureContextVectorIndex(collection, logger = console)` using the MongoDB 6.21 APIs present after `npm ci`:

```js
const [existing] = await collection
  .listSearchIndexes(CONTEXT_VECTOR_INDEX_NAME)
  .toArray();

if (!existing) {
  await collection.createSearchIndex({
    name: CONTEXT_VECTOR_INDEX_NAME,
    type: "vectorSearch",
    definition: CONTEXT_VECTOR_INDEX_DEFINITION,
  });
  return;
}

const definition = existing.latestDefinition ?? existing.definition;
if (
  existing.type !== "vectorSearch" ||
  !hasRequiredContextVectorDefinition(definition)
) {
  await collection.updateSearchIndex(
    CONTEXT_VECTOR_INDEX_NAME,
    CONTEXT_VECTOR_INDEX_DEFINITION,
  );
}
```

`hasRequiredContextVectorDefinition` must compare the normalized required vector path, dimensions, similarity, and both filter fields; unrelated extra metadata returned by Atlas may be ignored. Wrap only Search-index list/create/update operations in a catch that resolves after logging the index name and sanitized error class/code. Never log connection options or the URI. Keep connection and collection failures fatal, keep chronological Mongo history usable when Search DDL is unsupported, and do not update an already-correct index on every startup. The runtime requests an update but does not block all MongoDB startup on the asynchronous Atlas rebuild.

Verify the exact collection method signatures against the installed [MongoDB Node driver 6.21 Collection API](https://mongodb.github.io/node-mongodb-native/6.21/classes/Collection.html). Treat a successful update command as an accepted asynchronous rebuild request, not proof of readiness; real acceptance waits for the index state described in Step 6.

- [ ] **Step 6: Add an adversarial Atlas regression**

Extend `mongoSemanticSearch.integration.test.js` so it:

1. creates the existing real archived target event;
2. generates the exact query embedding with `generateQueryEmbedding`;
3. replaces the target event's embedding with a deterministic vector whose cosine similarity to the query is `0.95` and preserves `historyArchived: true`;
4. inserts at least five same-session, uniquely identified, otherwise complete semantic event documents with the exact query vector (cosine `1.0`) and `historyArchived: false`;
5. waits separately until Atlas reports `context_embedding_index` as queryable with the complete latest definition, failing immediately on an Atlas `FAILED` state and using a configurable default timeout of 300 seconds;
6. searches that exact session with `limit: 1`;
7. asserts that the `0.95` archived target is returned and no `1.0` partial ID is returned;
8. cleans up only the exact target session/event and partial IDs in `finally`.

Build the target vector without another provider call:

```js
function vectorAtCosine(queryVector, similarity) {
  const magnitude = Math.sqrt(
    queryVector.reduce((sum, value) => sum + value * value, 0),
  );
  const unitQuery = queryVector.map((value) => value / magnitude);
  const basisIndex = Math.abs(unitQuery[0]) < 0.9 ? 0 : 1;
  const basis = new Array(unitQuery.length).fill(0);
  basis[basisIndex] = 1;
  const projection = unitQuery[basisIndex];
  const orthogonal = basis.map(
    (value, index) => value - projection * unitQuery[index],
  );
  const orthogonalMagnitude = Math.sqrt(
    orthogonal.reduce((sum, value) => sum + value * value, 0),
  );
  const scale = Math.sqrt(1 - similarity * similarity);
  return unitQuery.map(
    (value, index) =>
      similarity * value + scale * (orthogonal[index] / orthogonalMagnitude),
  );
}
```

Assert the helper's computed cosine is within `1e-6` of `0.95` before writing the target. This makes the pre-fix failure deterministic: an unfiltered `limit: 1` selects a `1.0` partial document, whereas the archive prefilter selects the `0.95` durable event.

This test must remain gated by `STREAMSENSE_RUN_ATLAS_SEARCH_TEST=true`, `MONGODB_URI`, and `GOOGLE_API_KEY`. It must not print the URI, embedding, query payload, or credentials.

- [ ] **Step 7: Run backend unit and local persistence tests**

Run:

```bash
node --test ai-voice-realtime/test/contextMongo.test.js ai-voice-realtime/test/mongoSemanticHistoryService.test.js ai-voice-realtime/test/mongoHistoryRepository.test.js ai-voice-realtime/test/mongoEventUpsert.test.js
npm run test:mongo --workspace ai-voice-realtime
```

Expected: unit tests pass. The persistence integration passes when `MONGODB_TEST_URI` is configured; otherwise it reports an explicit skip rather than being claimed as exercised.

- [ ] **Step 8: Document the index upgrade and real Atlas command**

Update `docs/mongodb-atlas-handoff.md` to state that `context_embedding_index` must contain filter definitions for `sessionId` and `historyArchived`, that an existing older index is updated in place, and that the operator must wait until Atlas reports the index queryable before running acceptance.

- [ ] **Step 9: Commit only the backend retrieval boundary and its Atlas handoff**

Run:

```bash
git add ai-voice-realtime/src/context-builder/mongo.js ai-voice-realtime/test/contextMongo.test.js ai-voice-realtime/test/mongoSemanticSearch.integration.test.js docs/mongodb-atlas-handoff.md
git diff --cached --check
git diff --cached
git diff --cached --name-only
git commit -m "fix(backend): prefilter durable semantic events"
```

Expected: no dashboard, extension, narration-policy, or `package-lock.json` path is staged.

---

### Task 4: Narrow Wrapper-only Narration Suppression

**Files:**
- Modify: `ai-voice-realtime/src/gemini/transcript.js`
- Modify: `ai-voice-realtime/src/session/clientSession.js`
- Test: `ai-voice-realtime/test/sceneDescriptionPolicy.test.js`
- Test: `ai-voice-realtime/test/sceneDescriptionClientSession.test.js`

**Interfaces:**
- Preserves: `shouldSuppressVisualDescription(description) -> boolean`.
- Produces: a private `isWrapperOnlyVisualDescription(text) -> boolean` that recognizes complete wrapper/title descriptions without matching an incidental wrapper clause inside valid scene narration.
- Preserves: StreamSense self-interface and inferred-user-interaction rejection.

- [ ] **Step 1: Add failing false-positive regressions at the policy boundary**

Extend `sceneDescriptionPolicy.test.js` with:

```js
test("incidental wrapper wording does not suppress a visible scene", () => {
  for (const description of [
    "Two owls feed their chicks while the livestream is shown full-screen.",
    "Three players sprint into the box as the video page is shown on a stadium monitor.",
    "A livestream shows a bear climbing a snowy slope beneath pine trees.",
    "A YouTube video page is shown; two owls feed their chicks on snow.",
    "The video is titled Rare Wildlife as a bear climbs a steep slope.",
    "The livestream is shown full-screen while a bear climbs a snowy slope.",
    "A YouTube video page is displayed as two owls feed their chicks in the snow.",
    "A YouTube video page is shown with a video called Hidden Kingdoms. A bear climbs a snowy slope.",
    "A YouTube video page is shown with a video called Hidden Kingdoms because a bear climbs a snowy slope.",
    "A YouTube video page is shown with a video called Hidden Kingdoms showing a bear climbing a snowy slope.",
  ]) {
    assert.equal(shouldSuppressVisualDescription(description), false, description);
  }
});
```

Also retain positive cases for complete YouTube/browser/title wrapper output, StreamSense's own interface, and inferred user actions. Add case/punctuation variants such as `A VIDEO IS DISPLAYED FULL-SCREEN!` and `the browser page is shown with a livestream called Hidden Kingdoms.` so the narrow grammar remains deterministic without accepting arbitrary prose.

- [ ] **Step 2: Add failing persistence-level regressions**

In `sceneDescriptionClientSession.test.js`, run every substantive negative string from Step 1 through `ClientSession.recordGroundedAnalysis` as `analysis.description` and assert for each:

```js
assert.equal(eventMessages.length, 1);
assert.equal(eventMessages[0].event.description, description);
assert.equal(fixture.session.lastGroundedDescription, description);
```

Repeat the table through `analysis.event.description` with a safe scene-first fallback in `analysis.description`; assert each structured event is persisted instead of replaced or suppressed. Retain wrapper-only cases at both boundaries to prove the narrow grammar still rejects metadata-only output.

- [ ] **Step 3: Run the policy and ClientSession tests and verify the current regex fails**

Run:

```bash
node --test ai-voice-realtime/test/sceneDescriptionPolicy.test.js ai-voice-realtime/test/sceneDescriptionClientSession.test.js
```

Expected: the current anywhere-in-string wrapper regex suppresses the two valid `... is shown ...` descriptions.

- [ ] **Step 4: Replace anywhere-in-string matching with complete-description wrapper grammar**

In `transcript.js`, keep self-interface and inferred-interaction checks unchanged. Replace `describesOnlyMediaWrapper` with an anchored helper that parses only explicit wrapper metadata fields and validates every captured value:

```js
function isWrapperOnlyVisualDescription(text) {
  if (SIMPLE_WRAPPER_PATTERN.test(text)) return true;

  for (const pattern of PAGE_WITH_TITLE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const subject = match.groups?.subject;
    const title = match.groups?.title;
    if (
      (!subject || isMetadataNounPhrase(subject)) &&
      (!title || isBoundedMetadataValue(title))
    ) {
      return true;
    }
  }

  const titled = text.match(TITLED_WRAPPER_PATTERN);
  return Boolean(
    titled?.groups?.title && isBoundedMetadataValue(titled.groups.title),
  );
}

const PAGE_WITH_TITLE_PATTERNS = [
  /^(?:a|the)\s+(?:youtube|twitch|vimeo)\s+(?:video\s+)?page\s+(?:is\s+)?(?:displayed|shown|open)(?:(?:,\s*|\s+)(?:featuring|with)\s+(?:a\s+)?(?:video|livestream|stream)(?:\s+of\s+(?<subject>.+?))?\s+(?:titled|called)\s+(?<title>.+?))?[.!]?$/iu,
  /^(?:a|the)\s+(?:browser(?:\s+page)?|web\s?page|video\s?page|media\s?player)\s+(?:is\s+)?(?:displayed|shown|open)(?:(?:,\s*|\s+)(?:featuring|with)\s+(?:a\s+)?(?:video|livestream|stream)(?:\s+of\s+(?<subject>.+?))?\s+(?:titled|called)\s+(?<title>.+?))?[.!]?$/iu,
];

const TITLED_WRAPPER_PATTERN =
  /^(?:the\s+)?(?:video|livestream|stream)(?:\s+page)?\s+(?:is\s+)?(?:titled|called)\s+(?<title>.+?)\s+and\s+(?:is\s+)?(?:displayed|shown|open)(?:\s+(?:in|on)\s+(?:a|the)?\s*(?:media\s?player|video\s?page|browser\s?page))?[.!]?$/iu;

const SIMPLE_WRAPPER_PATTERN =
  /^(?:a|the)\s+(?:video|livestream|stream)(?:\s+page)?\s+(?:is\s+)?(?:displayed|shown|open)(?:\s+full-?screen)?[.!]?$/iu;

const INTERNAL_PROSE_PUNCTUATION = /[.!?;,:]|[\r\n]/u;
const TITLE_CONNECTORS = new Set([
  "a", "an", "and", "at", "for", "from", "in", "of", "on", "the", "to", "vs", "with",
]);

function isBoundedMetadataValue(value) {
  const text = value.trim();
  const quoted = /^(?:"[^"]{1,160}"|'[^']{1,160}'|“[^”]{1,160}”)$/u.test(text);
  if (quoted) return true;
  if (INTERNAL_PROSE_PUNCTUATION.test(text)) return false;
  const words = text.split(/\s+/u);
  return words.length <= 12 && words.every((word) => {
    const normalized = word.toLocaleLowerCase("en-US");
    return TITLE_CONNECTORS.has(normalized) ||
      /^[\p{Lu}\p{N}][\p{L}\p{N}'’&+\-]*$/u.test(word);
  });
}

function isMetadataNounPhrase(value) {
  const text = value.trim();
  const words = text.split(/\s+/u);
  return (
    words.length <= 6 &&
    !INTERNAL_PROSE_PUNCTUATION.test(text) &&
    !/\b(?:as|while|where|who|which|that|because|showing)\b/iu.test(text) &&
    words.every((word) => !/(?:ing|ed)$/iu.test(word))
  );
}
```

Before finalizing the parser, execute every positive and negative table case against it. Captures are never accepted directly: arbitrary titles must be quoted; unquoted titles must contain only title-shaped capitalized words/numbers and the listed connectors; internal sentence punctuation is rejected; and optional `of ...` subjects must be short noun phrases. The unquoted titled-video form is accepted only when followed by the mandatory literal wrapper tail `and is displayed/shown/open ...`; ambiguous title-only prose fails open. Fail open whenever a second clause or sentence contains non-wrapper prose. Do not add a broad scene-action allowlist: an incomplete verb list would silently reintroduce false positives for unfamiliar sports, wildlife, concerts, or creator content.

- [ ] **Step 5: Make telemetry state the actual suppression classes**

Change the ClientSession telemetry text to a bounded, non-sensitive message such as:

```js
text: "visual analysis suppressed: interface, inferred interaction, or wrapper-only output",
```

Do not include the rejected generated description in telemetry.

- [ ] **Step 6: Run the narration-focused regression suite**

Run:

```bash
node --test ai-voice-realtime/test/sceneDescriptionPolicy.test.js ai-voice-realtime/test/sceneDescriptionClientSession.test.js ai-voice-realtime/test/vision.test.js ai-voice-realtime/test/clientSession.test.js ai-voice-realtime/test/narrationCandidate.test.js ai-voice-realtime/test/speechPolicy.test.js
```

Expected: all tests pass; prompt assertions, event-before-speech behavior, duplicate/stale suppression, and voice policy remain unchanged.

- [ ] **Step 7: Commit only the Live narration boundary**

Run:

```bash
git add ai-voice-realtime/src/gemini/transcript.js ai-voice-realtime/src/session/clientSession.js ai-voice-realtime/test/sceneDescriptionPolicy.test.js ai-voice-realtime/test/sceneDescriptionClientSession.test.js
git diff --cached --check
git diff --cached
git diff --cached --name-only
git commit -m "fix(live): narrow wrapper-only scene suppression"
```

Expected: no dashboard, MongoDB retrieval, extension, docs, or `package-lock.json` path is staged.

---

### Task 5: Reconcile the Current Documentation

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/README.md`
- Modify: `docs/scene-description-and-domain-policy.md`
- Modify: `docs/context-graph-api.md`
- Modify: `docs/semantic-history-integration.md`
- Modify: `README.md`
- Modify: `session-dashboard/README.md`
- Modify: `ai-voice-realtime/README.md`

**Interfaces:**
- Consumes: implemented and tested behavior from Tasks 2–4.
- Produces: current, discoverable documentation that does not claim physical acceptance before Task 6 records it.

- [ ] **Step 1: Update architecture only after code behavior exists**

Document these exact behaviors in `docs/architecture.md`:

- overview graphs reserve only the five canonical lanes and omit unknown-only subgraphs;
- the same unknown session remains reachable through its session card and retains all supplied relationships in its 2D session-scoped map under the honest `Domain unavailable` fallback;
- vector search prefilters `historyArchived: true` before candidate limiting and score thresholding;
- the Atlas vector index includes filter fields for both `sessionId` and `historyArchived`;
- wrapper suppression matches complete metadata-wrapper output, not valid scenes with incidental page/player wording.

Update `docs/context-graph-api.md` to remove its obsolete promise that unknown history creates a sixth `Other entertainment` lane. Specify the route split: canonical overview projection omits unknown-only subgraphs, while the exact session graph retains its supplied nodes/edges in 2D with an honest absence label and readable relationships.

Update `docs/semantic-history-integration.md` to state the exact retrieval order: vector prefilter `historyArchived: true` plus optional `sessionId` → candidate limit → vector score metadata → `0.8` threshold → bounded projection. Document both required index filter fields and the boundary between normal unit/local-persistence coverage and real Atlas acceptance.

- [ ] **Step 2: Make the policy discoverable**

Add `docs/scene-description-and-domain-policy.md` to `docs/README.md`. Link it from the relevant narration section of `ai-voice-realtime/README.md` and the relationship/domain section of `session-dashboard/README.md`.

- [ ] **Step 3: Reconcile finals instructions without overstating verification**

Update the root README and package READMEs with:

- `STREAMSENSE_HISTORY_MODE=mongodb` as the finals fail-fast mode;
- the real Live → exact Memory session → restart → search/graph acceptance sequence;
- the opt-in Atlas semantic test command;
- an explicit statement that normal CI covers pure pipeline/index logic and local persistence but not real Atlas Vector Search or physical Chrome/provider behavior.

Do not change any verification status to PASS in this task.

- [ ] **Step 4: Run documentation and focused regression checks**

Run:

```bash
git diff --check
npm test --workspace session-dashboard -- src/test/domainPresentation.test.tsx src/test/graphModel.test.ts src/test/ThreeGraphExplorer.test.tsx
node --test ai-voice-realtime/test/contextMongo.test.js ai-voice-realtime/test/sceneDescriptionPolicy.test.js ai-voice-realtime/test/sceneDescriptionClientSession.test.js
```

Expected: no broken formatting, and all behavior documented in this task remains covered by passing tests.

- [ ] **Step 5: Commit only current documentation**

Run:

```bash
git add docs/architecture.md docs/README.md docs/scene-description-and-domain-policy.md docs/context-graph-api.md docs/semantic-history-integration.md README.md session-dashboard/README.md ai-voice-realtime/README.md
git diff --cached --check
git diff --cached
git diff --cached --name-only
git commit -m "docs: define demo-ready domain and semantic behavior"
```

Expected: only the eight listed current documentation files are staged; no verification record claims observations that have not happened.

---

### Task 6: Prove Release Readiness on the Presentation Stack

**Files:**
- Create after the observations exist: `docs/verification/2026-08-21-demo-readiness-acceptance.md`
- Do not modify: `package-lock.json`

**Interfaces:**
- Consumes: all Task 2–5 commits, configured development Atlas, real Chrome, Gemini credentials, Cloud STT ADC, Chrome/OS TTS, and the unpacked extension.
- Produces: sanitized evidence for automated checks, Atlas semantic correctness, real Live-to-Memory persistence, narration false-positive coverage, and two complete demo rehearsals.

- [ ] **Step 1: Review the complete diff and preserve unrelated state**

Run:

```bash
git status --short
git diff --check
git diff --name-status 39cef9d9f30d5b3d04e615247a23f09a70515760...HEAD
git diff --name-status dev...HEAD
git diff -- package-lock.json
git worktree list --porcelain
```

Expected: the execution worktree is clean, its committed lockfile has no diff, only planned source/test/docs paths were added after `39cef9d`, and the full inherited `dev...HEAD` release delta has been reviewed for product-boundary surprises. Separately verify that the original worktree still contains its untouched unstaged lockfile diff.

- [ ] **Step 2: Run the full repository gate**

Run on macOS/Linux:

```bash
npm run check
```

Run the equivalent required command on Windows:

```powershell
npm.cmd run check
```

Expected: orchestration, backend, extension, dashboard tests, typechecks, and builds all pass. Record the exact pass/skip counts and the large-chunk warning separately.

- [ ] **Step 3: Run local MongoDB persistence acceptance when the optional local store is intentionally available**

Run:

```bash
docker compose up -d mongodb
MONGODB_TEST_URI=mongodb://127.0.0.1:27017 npm run test:mongo --workspace ai-voice-realtime
docker compose stop mongodb
```

Expected: shared-document persistence passes. This does not count as Atlas Vector Search acceptance.

- [ ] **Step 4: Run the adversarial Atlas semantic test**

With ignored environment files populated by the operator, run:

```bash
STREAMSENSE_RUN_ATLAS_SEARCH_TEST=true node --env-file=ai-voice-realtime/.env --env-file=ai-voice-realtime/.env.local --test ai-voice-realtime/test/mongoSemanticSearch.integration.test.js
```

Expected: Atlas first reports the complete index definition queryable; the archived `0.95` event is returned with `limit: 1` despite five same-session `1.0` semantic-only partial documents; the exact session/timeline/graph survives reconnect; cleanup removes only the test's generated IDs. Record the outcome without credentials, embeddings, or private payloads.

- [ ] **Step 5: Perform the real Chrome/provider persistence flow**

Provision the ignored finals environment in the clean execution worktree. Start the presentation profile with:

```bash
STREAMSENSE_HISTORY_MODE=mongodb npm run demo
```

Before opening Chrome, require the sanitized startup line `Memory history provider: MongoDB (durable)` and confirm port 8000 is owned by this exact backend process. Then:

1. load/reload `chrome-extension/dist` and confirm the exact extension ID is allowlisted;
2. authorize one HTTP(S) video tab and start Live;
3. capture a visually distinctive scene and confirm its scene-first description is persisted in the Live timeline before Chrome/OS TTS speaks that exact text;
4. attempt a scene likely to yield incidental `video` or `livestream` wording; if the actual generated description contains that wording, confirm it is not silently suppressed, otherwise record this physical subcase as not exercised and rely only on the deterministic regression rather than inventing evidence;
5. ask one typed or microphone question and confirm the response does not create a competing automatic event;
6. click **Open Memory Dashboard** and record the session UUID from `/dashboard/sessions/{sessionId}` without exposing the extension ID;
7. confirm the exact session, event, semantic search result, five-lane overview behavior, 2D session graph, and readable relationship list;
8. stop the backend, restart the same `npm run demo` profile, and confirm the same session/event/search/graph data remains;
9. confirm no `unknown`, `unclassified`, or `Other entertainment` category appears anywhere, while the unknown-domain session remains reachable from its session card and readable session view.

Expected: every mandatory observation passes on the actual presentation laptop and network, and both initial startup and restart report `Memory history provider: MongoDB (durable)`. Any mandatory failure blocks release disposition until fixed and rerun.

- [ ] **Step 6: Measure the existing bundle warning instead of speculating**

Measure from clicking **Open Memory Dashboard** until the dashboard heading, session cards, and labeled graph selector are usable on the presentation laptop after one cold browser load.

Acceptance target: usable within 3 seconds over loopback. If it passes, record the approximately 1.16 MB warning as accepted non-blocking debt. If it fails, stop release and create a separate focused plan to lazy-load `threeGraphRenderer.ts`; do not mix an unreviewed performance refactor into these correctness fixes.

- [ ] **Step 7: Rehearse the exact judge journey twice**

Run twice without database edits or synthetic fixtures:

```text
Live capture
→ scene-first narration
→ one question
→ exact recorded timeline event
→ Open Memory Dashboard
→ exact saved session
→ semantic search
→ relationship graph and readable relationships
```

Expected: both rehearsals use the exact fail-fast MongoDB profile, begin with the durable-provider startup line, and complete without reload loops, stale domain filters, silent narration loss, empty Memory fallback, or manual MongoDB repair. Capture a short backup screen recording only after the live path passes.

- [ ] **Step 8: Write the sanitized acceptance record from observed facts**

Create `docs/verification/2026-08-21-demo-readiness-acceptance.md` containing:

- branch and full commit SHA;
- Asia/Singapore timestamps;
- Node, npm, Chrome, and platform versions;
- automated command results and exact pass/skip counts;
- deterministic missing-URI fail-closed result from Task 1;
- durable-provider startup line observed for the live run and restart;
- local persistence result;
- Atlas adversarial semantic result;
- physical session persistence result;
- narration wrapper regression observation;
- five-lane/unknown-domain observation;
- cold dashboard interaction time;
- rehearsal 1 and rehearsal 2 results;
- non-blocking warnings;
- final PASS or FAIL disposition.

Do not include credentials, extension IDs, MongoDB hostnames, IP addresses, private transcript text, account data, embeddings, or raw provider payloads.

- [ ] **Step 9: Re-run the full check immediately before the final evidence commit**

Run:

```bash
npm run check
git diff --check
```

Expected: every workspace gate passes after the verification record is written and before the final commit is created.

- [ ] **Step 10: Commit only truthful verification evidence**

Run:

```bash
git add docs/verification/2026-08-21-demo-readiness-acceptance.md
git diff --cached --check
git diff --cached
git diff --cached --name-only
git commit -m "docs: record demo readiness acceptance"
```

Expected: the record reports PASS only if every mandatory Task 6 gate was actually observed; otherwise it reports FAIL with sanitized symptoms and no release claim.

- [ ] **Step 11: Perform the final repository and history review**

Run:

```bash
npm run check
git diff --check
git status --short
git log --oneline --decorate 39cef9d9f30d5b3d04e615247a23f09a70515760..HEAD
git diff --name-status dev...HEAD
```

Expected: all checks pass, the clean execution worktree has no uncommitted paths, commit boundaries remain plan/dashboard/backend/Live/docs/verification, and the original worktree's unrelated `package-lock.json` drift remains untouched outside this branch. Do not push, open a pull request, merge, or modify remote state without explicit user authorization.

## Release Gate

The branch is demo-ready only when all of the following are true:

- exactly five canonical overview lanes render and unknown-only overview subgraphs do not create a sixth category;
- unknown session pages preserve their supplied nodes and readable relationships under the honest `Domain unavailable` absence state, without raw or fabricated domain categories;
- vector search prefilters durable events before limiting and the deployed Atlas index supports that filter;
- valid scene narration with incidental wrapper wording persists, while complete page/title wrapper output remains rejected;
- full repository checks pass;
- adversarial Atlas search passes;
- the exact real Live session/event/search/graph survives backend restart;
- the dashboard meets the 3-second presentation-laptop interaction target or receives a separately reviewed performance fix;
- two consecutive judge-flow rehearsals pass;
- verification evidence is sanitized and truthful;
- unrelated lockfile drift is not included.
