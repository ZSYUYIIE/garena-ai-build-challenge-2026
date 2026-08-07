import {
  historySessionSchema,
  normalizeHistoryEvent,
  semanticSearchResultSchema,
} from "./historySchemas.js";

export const DEMO_DATA_LABEL = "DEVELOPMENT / DEMO DATA";

export const DEMO_SESSION_IDS = Object.freeze({
  footballA: "11111111-1111-4111-8111-111111111111",
  footballB: "22222222-2222-4222-8222-222222222222",
  esports: "33333333-3333-4333-8333-333333333333",
});

export function createDemoHistory() {
  const definitions = [
    {
      sessionId: DEMO_SESSION_IDS.footballA,
      title: "Harbour City vs Northbridge United",
      domain: "football",
      sourceLabel: `${DEMO_DATA_LABEL} · Match broadcast`,
      startedAt: "2026-07-28T11:00:00.000Z",
      durationSeconds: 2_880,
      summary: "Harbour City absorbed early pressure, then changed the match through quick counterattacks and two decisive finishes. Goalkeeper Mina Lee's saves preserved the lead after a late Northbridge surge.",
      events: [
        [75, "possession_change", ["Northbridge United"], "Northbridge United settles into early possession near midfield.", 0.52, 0.91, ["Possession", "Opening phase"]],
        [198, "dangerous_attack", ["Northbridge United", "Eli Torres"], "Eli Torres carries the ball into the final third with two runners ahead.", 0.76, 0.89, ["Final-third pressure", "Momentum shift"]],
        [222, "shot_saved", ["Mina Lee", "Northbridge United"], "Mina Lee dives low to stop a close-range effort.", 0.91, 0.94, ["Defensive save", "Goalkeeping"]],
        [438, "counterattack", ["Harbour City", "Player 9"], "Harbour City breaks quickly through Player 9 after recovering the ball.", 0.81, 0.9, ["Counterattack", "Transition play"]],
        [461, "goal", ["Harbour City", "Player 9"], "Player 9 finishes the counterattack into the bottom-left corner.", 0.98, 0.97, ["Counterattack", "Goal", "Momentum shift"]],
        [1_023, "substitution", ["Harbour City", "Ari Santos"], "Ari Santos enters to reinforce Harbour City's midfield.", 0.66, 0.93, ["Substitution impact", "Midfield control"]],
        [1_267, "dangerous_attack", ["Harbour City", "Ari Santos"], "Ari Santos creates a three-on-two attack down the right.", 0.8, 0.9, ["Final-third pressure", "Substitution impact"]],
        [1_415, "shot_saved", ["Northbridge United goalkeeper", "Player 9"], "Northbridge's goalkeeper blocks Player 9's rising shot.", 0.85, 0.92, ["Defensive save", "Goalkeeping"]],
        [1_784, "possession_change", ["Northbridge United"], "Northbridge wins the ball high and begins sustained pressure.", 0.62, 0.88, ["Possession", "Momentum shift"]],
        [2_103, "substitution", ["Northbridge United", "Noah Kim"], "Noah Kim enters as Northbridge adds another attacker.", 0.69, 0.94, ["Substitution impact", "Comeback"]],
        [2_412, "goal", ["Harbour City", "Ari Santos"], "Ari Santos scores from the edge of the area after another fast transition.", 0.99, 0.97, ["Goal", "Counterattack", "Substitution impact"]],
        [2_846, "final_whistle", ["Harbour City", "Northbridge United"], "The match ends with Harbour City protecting a two-goal advantage.", 0.78, 0.99, ["Match result", "Defensive resilience"]],
      ],
    },
    {
      sessionId: DEMO_SESSION_IDS.footballB,
      title: "Eastport Rovers vs Valley Athletic",
      domain: "football",
      sourceLabel: `${DEMO_DATA_LABEL} · Match broadcast`,
      startedAt: "2026-07-24T13:30:00.000Z",
      durationSeconds: 3_120,
      summary: "Valley Athletic led from an early penalty, but Eastport's second-half substitutions changed the tempo. A late equalizer completed the comeback after repeated final-third pressure.",
      events: [
        [184, "penalty", ["Valley Athletic", "Samir Patel"], "Valley Athletic wins a penalty after Samir Patel is fouled.", 0.94, 0.96, ["Penalty", "Turning point"]],
        [211, "goal", ["Valley Athletic", "Samir Patel"], "Samir Patel converts the penalty with a low finish.", 0.98, 0.98, ["Goal", "Penalty", "Momentum shift"]],
        [603, "shot_saved", ["Eastport goalkeeper", "Valley Athletic"], "Eastport's goalkeeper tips a powerful header over the bar.", 0.86, 0.93, ["Defensive save", "Goalkeeping"]],
        [1_112, "possession_change", ["Eastport Rovers"], "Eastport begins controlling possession after the interval.", 0.61, 0.9, ["Possession", "Momentum shift"]],
        [1_408, "substitution", ["Eastport Rovers", "Lina Wu"], "Lina Wu enters and moves Eastport into a more attacking shape.", 0.73, 0.95, ["Substitution impact", "Comeback"]],
        [1_625, "dangerous_attack", ["Eastport Rovers", "Lina Wu"], "Lina Wu combines centrally as Eastport crowds the penalty area.", 0.82, 0.91, ["Final-third pressure", "Substitution impact"]],
        [1_906, "counterattack", ["Valley Athletic"], "Valley Athletic counters into open space but the final pass runs long.", 0.72, 0.88, ["Counterattack", "Transition play"]],
        [2_244, "shot_saved", ["Valley Athletic goalkeeper", "Eastport Rovers"], "Valley's goalkeeper makes a reflex save during sustained Eastport pressure.", 0.88, 0.94, ["Defensive save", "Final-third pressure"]],
        [2_761, "goal", ["Eastport Rovers", "Lina Wu"], "Lina Wu turns in a low cross to complete Eastport's comeback.", 0.99, 0.97, ["Goal", "Comeback", "Substitution impact"]],
        [3_086, "final_whistle", ["Eastport Rovers", "Valley Athletic"], "The match finishes level after Eastport's late recovery.", 0.76, 0.99, ["Match result", "Comeback"]],
      ],
    },
    {
      sessionId: DEMO_SESSION_IDS.esports,
      title: "Crimson Core vs Neon Rift",
      domain: "esports",
      sourceLabel: `${DEMO_DATA_LABEL} · Esports livestream`,
      startedAt: "2026-07-20T09:00:00.000Z",
      durationSeconds: 2_340,
      summary: "Neon Rift controlled the opening objectives, but Crimson Core stabilized through disciplined teamfights. A stolen final objective triggered the comeback and match-winning push.",
      events: [
        [142, "objective_taken", ["Neon Rift", "First Drake"], "Neon Rift secures the first major objective without a contest.", 0.78, 0.96, ["Objective control", "Opening advantage"]],
        [388, "teamfight", ["Crimson Core", "Neon Rift"], "Neon Rift wins a four-player fight near the river.", 0.9, 0.93, ["Teamfight", "Momentum shift"]],
        [421, "elimination", ["Neon Rift", "Crimson Core support"], "Neon Rift eliminates Crimson Core's support while exiting the river.", 0.71, 0.92, ["Elimination", "Teamfight"]],
        [707, "objective_taken", ["Crimson Core", "Outer tower"], "Crimson Core trades for an outer tower and closes the gold gap.", 0.73, 0.91, ["Objective control", "Comeback"]],
        [982, "teamfight", ["Crimson Core", "Neon Rift"], "Crimson Core disengages, then re-enters to win a close teamfight.", 0.93, 0.94, ["Teamfight", "Comeback", "Momentum shift"]],
        [1_107, "elimination", ["Crimson Core", "Neon Rift carry"], "Crimson Core catches Neon Rift's carry away from the team.", 0.84, 0.95, ["Elimination", "Map pressure"]],
        [1_462, "objective_taken", ["Neon Rift", "Baron"], "Neon Rift secures Baron and regains map control.", 0.92, 0.96, ["Objective control", "Momentum shift"]],
        [1_788, "teamfight", ["Crimson Core", "Neon Rift"], "Crimson Core survives Neon Rift's Baron push and wins the base fight.", 0.96, 0.95, ["Teamfight", "Defensive save", "Comeback"]],
        [2_031, "objective_taken", ["Crimson Core", "Elder objective"], "Crimson Core steals the final objective with a last-second secure.", 0.99, 0.96, ["Objective control", "Comeback", "Turning point"]],
        [2_287, "match_won", ["Crimson Core", "Neon Rift"], "Crimson Core completes the comeback and destroys the final base structure.", 1, 0.99, ["Match result", "Comeback"]],
      ],
    },
  ];

  const sessions = [];
  const events = [];
  definitions.forEach((definition, sessionIndex) => {
    const sessionEvents = definition.events.map((eventDefinition, eventIndex) =>
      createEvent(definition, sessionIndex, eventIndex, eventDefinition));
    const entities = unique(sessionEvents.flatMap((event) => event.entities));
    const topics = unique(sessionEvents.flatMap((event) => event.topicLabels));
    const endedAt = new Date(
      Date.parse(definition.startedAt) + definition.durationSeconds * 1_000,
    ).toISOString();
    sessions.push(historySessionSchema.parse({
      sessionId: definition.sessionId,
      startedAt: definition.startedAt,
      endedAt,
      durationSeconds: definition.durationSeconds,
      title: definition.title,
      domain: definition.domain,
      sourceLabel: definition.sourceLabel,
      summary: definition.summary,
      eventCount: sessionEvents.length,
      importantEventCount: sessionEvents.filter((event) => event.importance >= 0.75).length,
      entities,
      topics,
      dataOrigin: "demo",
      createdAt: definition.startedAt,
      updatedAt: endedAt,
    }));
    events.push(...sessionEvents);
  });

  return { label: DEMO_DATA_LABEL, sessions, events };
}

export async function seedDemoHistory(repository) {
  const demo = createDemoHistory();
  for (const session of demo.sessions) await repository.upsertSession(session);
  for (const event of demo.events) await repository.archiveEvent(event);
  return demo;
}

export function createDemoSemanticResults(demo = createDemoHistory()) {
  const selections = [
    [DEMO_SESSION_IDS.footballA, "counterattack", 0.91],
    [DEMO_SESSION_IDS.footballB, "shot_saved", 0.87],
    [DEMO_SESSION_IDS.esports, "teamfight", 0.83],
  ];
  return selections.map(([sessionId, eventType, similarity]) => {
    const event = demo.events.find(
      (candidate) => candidate.sessionId === sessionId && candidate.eventType === eventType,
    );
    const session = demo.sessions.find((candidate) => candidate.sessionId === sessionId);
    return semanticSearchResultSchema.parse({
      sessionId,
      sessionTitle: session.title,
      eventId: event.id,
      timestampSeconds: event.timestampSeconds,
      timestamp: event.timestamp,
      eventType: event.eventType,
      description: event.description,
      entities: event.entities,
      topics: event.topicLabels,
      similarity,
    });
  });
}

function createEvent(definition, sessionIndex, eventIndex, [
  timestampSeconds,
  eventType,
  entities,
  description,
  importance,
  confidence,
  topicLabels,
]) {
  return normalizeHistoryEvent({
    id: deterministicEventId(sessionIndex, eventIndex),
    sessionId: definition.sessionId,
    timestampSeconds,
    eventType,
    entities,
    description,
    importance,
    confidence,
    topicLabels,
    createdAt: new Date(
      Date.parse(definition.startedAt) + timestampSeconds * 1_000,
    ).toISOString(),
  });
}

function deterministicEventId(sessionIndex, eventIndex) {
  const prefix = String(sessionIndex + 1).padStart(8, "0");
  const suffix = String(sessionIndex * 100 + eventIndex + 1).padStart(12, "0");
  return `${prefix}-0000-4000-8000-${suffix}`;
}

function unique(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
