import assert from "node:assert/strict";
import test from "node:test";

import { createDemoHistory } from "../src/history/demoHistory.js";
import { HistoryService } from "../src/history/historyService.js";
import { MemoryHistoryRepository } from "../src/history/memoryHistoryRepository.js";

test("archive retry repairs a session aggregate after a partial write failure", async () => {
  const demo = createDemoHistory();
  const repository = new FailOnceAggregateRepository();
  const service = new HistoryService({ repository });
  const session = demo.sessions[0];
  const event = demo.events.find((item) => item.sessionId === session.sessionId);
  await service.startSession({
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    dataOrigin: "demo",
  });
  repository.failNextAggregate = true;

  await assert.rejects(service.archiveEvent(event), /aggregate write failed/);
  assert.equal(repository.getSession(session.sessionId).eventCount, 0);
  assert.equal(repository.listSessionEvents(session.sessionId).items.length, 1);

  const retry = await service.archiveEvent(event);
  const repaired = repository.getSession(session.sessionId);
  assert.equal(retry.inserted, false);
  assert.equal(repaired.eventCount, 1);
  assert.equal(repaired.importantEventCount, event.importance >= 0.75 ? 1 : 0);
  assert.deepEqual(repaired.entities, event.entities);
  assert.deepEqual(repaired.topics, event.topicLabels);
});

test("finishSession recomputes authoritative counts, entities, topics, and summary", async () => {
  const demo = createDemoHistory();
  const repository = new MemoryHistoryRepository();
  const service = new HistoryService({ repository });
  const session = demo.sessions[1];
  const events = demo.events.filter((item) => item.sessionId === session.sessionId).slice(0, 3);
  repository.upsertSession({ ...session, eventCount: 0, importantEventCount: 0, entities: [], topics: [] });
  for (const event of events) repository.archiveEvent(event);

  const finished = await service.finishSession({
    sessionId: session.sessionId,
    endedAt: session.endedAt,
    durationSeconds: session.durationSeconds,
  });

  assert.equal(finished.eventCount, events.length);
  assert.equal(
    finished.importantEventCount,
    events.filter((event) => event.importance >= 0.75).length,
  );
  assert.equal(finished.entities.length > 0, true);
  assert.equal(finished.topics.length > 0, true);
  assert.match(finished.summary, new RegExp(`${events.length} significant`));
});

class FailOnceAggregateRepository extends MemoryHistoryRepository {
  failNextAggregate = false;

  upsertSession(input) {
    if (this.failNextAggregate && input.eventCount > 0) {
      this.failNextAggregate = false;
      throw new Error("aggregate write failed");
    }
    return super.upsertSession(input);
  }
}
