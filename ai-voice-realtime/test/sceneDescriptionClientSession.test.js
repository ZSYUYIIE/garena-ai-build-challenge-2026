import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { EventStore } from "../src/events/eventStore.js";
import { ClientSession } from "../src/session/clientSession.js";

const WRAPPER_DESCRIPTION =
  "A YouTube video page is displayed, featuring a wildlife video titled Rare Wildlife.";
const SCENE_DESCRIPTION =
  "Two adult owls and three chicks feed on prey on a patch of snow.";

test("ClientSession drops wrapper-only visual analysis before timeline persistence", () => {
  const fixture = createFixture();
  try {
    const snapshot = admitFrame(fixture.session);

    fixture.session.recordGroundedAnalysis(
      narrationAnalysis(WRAPPER_DESCRIPTION, "wrapper:youtube"),
      snapshot,
      { initial: true },
    );

    assert.equal(
      fixture.browser.messages.some((message) => message.type === "event"),
      false,
    );
    assert.equal(fixture.session.lastGroundedDescription, "");
    assert.equal(
      fixture.browser.messages.some(
        (message) =>
          message.type === "telemetry" &&
          /visual analysis suppressed/i.test(message.text),
      ),
      true,
    );
  } finally {
    fixture.eventStore.close();
  }
});

test("ClientSession records and publishes a scene-first narration event", () => {
  const fixture = createFixture();
  try {
    const snapshot = admitFrame(fixture.session);

    fixture.session.recordGroundedAnalysis(
      narrationAnalysis(SCENE_DESCRIPTION, "wildlife:owls-feeding"),
      snapshot,
      { initial: true },
    );

    const eventMessage = fixture.browser.messages.find(
      (message) => message.type === "event",
    );
    assert.ok(eventMessage);
    assert.equal(eventMessage.event.description, SCENE_DESCRIPTION);
    assert.equal(eventMessage.event.eventType, "scene_observed");
    assert.equal(fixture.session.lastGroundedDescription, SCENE_DESCRIPTION);
  } finally {
    fixture.eventStore.close();
  }
});

test("ClientSession drops a wrapper-only structured event and persists the scene-first fallback", () => {
  const fixture = createFixture();
  try {
    const snapshot = admitFrame(fixture.session);
    const analysis = narrationAnalysis(
      SCENE_DESCRIPTION,
      "wildlife:owls-feeding",
    );
    analysis.event = {
      eventType: "scene_observed",
      entities: ["owls"],
      description: WRAPPER_DESCRIPTION,
      importance: 0.8,
      confidence: 0.9,
    };
    analysis.eventEvidence = {
      basis: "current_frame",
      previousState: null,
    };

    fixture.session.recordGroundedAnalysis(analysis, snapshot, { initial: true });

    const eventMessages = fixture.browser.messages.filter(
      (message) => message.type === "event",
    );
    assert.equal(eventMessages.length, 1);
    assert.equal(eventMessages[0].event.description, SCENE_DESCRIPTION);
    assert.notEqual(eventMessages[0].event.description, WRAPPER_DESCRIPTION);
    assert.equal(eventMessages[0].event.eventType, "scene_observed");
    assert.equal(fixture.session.lastGroundedDescription, SCENE_DESCRIPTION);
  } finally {
    fixture.eventStore.close();
  }
});

function createFixture() {
  const browser = new FakeBrowser();
  const eventStore = new EventStore();
  const session = new ClientSession(browser, eventStore, {
    now: () => 1_000,
  });
  return { browser, eventStore, session };
}

function admitFrame(session) {
  session.sendVideo(Buffer.from("scene-frame"), "image/jpeg", 1, {
    force: true,
    scheduleNarration: false,
  });
  const snapshot = session.captureFrameSnapshot();
  assert.ok(snapshot);
  return snapshot;
}

function narrationAnalysis(description, semanticKey) {
  return {
    shouldNarrate: true,
    description,
    semanticKey,
    importance: 0.8,
    isNew: true,
    coveredByTabSpeech: false,
    event: null,
    visibleState: null,
    eventEvidence: null,
  };
}

class FakeBrowser {
  constructor() {
    this.readyState = WebSocket.OPEN;
    this.bufferedAmount = 0;
    this.messages = [];
    this.closed = [];
  }

  send(serialized) {
    this.messages.push(JSON.parse(serialized));
  }

  close(code, reason) {
    this.closed.push({ code, reason });
    this.readyState = WebSocket.CLOSED;
  }

  on() {}
}
