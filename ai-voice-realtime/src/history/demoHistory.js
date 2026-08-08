import {
  historySessionSchema,
  normalizeHistoryEvent,
  semanticSearchResultSchema,
} from "./historySchemas.js";

export const DEMO_DATA_LABEL = "DEVELOPMENT / DEMO DATA";

export const DEMO_SESSION_IDS = Object.freeze({
  sports: "11111111-1111-4111-8111-111111111111",
  esports: "22222222-2222-4222-8222-222222222222",
  concert: "33333333-3333-4333-8333-333333333333",
  productLaunch: "44444444-4444-4444-8444-444444444444",
  creator: "55555555-5555-4555-8555-555555555555",
});

export const DEMO_SESSION_TITLES = Object.freeze({
  sports: "Football: Harbour City comeback vs Northbridge",
  esports: "Esports: Crimson Core vs Neon Rift",
  concert: "Concert: Aria Nova live at Harbour Lights",
  productLaunch: "Product launch: Nova One reveal",
  creator: "Creator livestream: Mina Park community build",
});

export function createDemoHistory() {
  const definitions = [
    {
      sessionId: DEMO_SESSION_IDS.sports,
      title: DEMO_SESSION_TITLES.sports,
      domain: "football",
      sourceLabel: `${DEMO_DATA_LABEL} - Football match broadcast`,
      startedAt: "2026-07-28T11:00:00.000Z",
      durationSeconds: 3_000,
      summary: "Northbridge controlled the opening, but Harbour City changed the match through Mateo Silva's decisive counterattack and late winner.",
      events: [
        [150, "possession_change", ["Northbridge United"], "Northbridge settles into early possession near midfield.", 0.35, 0.91, ["Match momentum"]],
        [750, "dangerous_attack", ["Harbour City", "Mateo Silva"], "Mateo Silva carries the ball into the penalty area as Harbour City responds.", 0.55, 0.9, ["Match momentum"]],
        [1_500, "shot_saved", ["Mateo Silva", "Northbridge United"], "Northbridge blocks Mateo Silva's close-range effort.", 0.72, 0.94, ["Turning point"]],
        [2_250, "counterattack", ["Harbour City", "Mateo Silva"], "Harbour City breaks forward with Northbridge outnumbered.", 0.88, 0.95, ["Turning point"]],
        [2_850, "goal", ["Harbour City", "Mateo Silva"], "Mateo Silva finishes the counterattack to complete Harbour City's comeback.", 0.98, 0.98, ["Turning point", "Match momentum"]],
      ],
    },
    {
      sessionId: DEMO_SESSION_IDS.esports,
      title: DEMO_SESSION_TITLES.esports,
      domain: "esports",
      sourceLabel: `${DEMO_DATA_LABEL} - MOBA esports livestream`,
      startedAt: "2026-07-27T09:00:00.000Z",
      durationSeconds: 2_400,
      summary: "Neon Rift led through the opening objectives before Crimson Core stole Elder Dragon and converted the turning point into a winning push.",
      events: [
        [120, "objective_taken", ["Neon Rift"], "Neon Rift secures the first neutral objective uncontested.", 0.35, 0.94, ["Objective control"]],
        [600, "teamfight", ["Crimson Core", "Neon Rift"], "Neon Rift wins the first river teamfight and extends its lead.", 0.55, 0.93, ["Objective control"]],
        [1_200, "objective_taken", ["Crimson Core"], "Crimson Core trades a tower and begins closing the gap.", 0.72, 0.92, ["Turning point"]],
        [1_800, "teamfight", ["Crimson Core", "Neon Rift"], "Crimson Core survives the base fight and forces Neon Rift back.", 0.88, 0.95, ["Turning point"]],
        [2_280, "objective_taken", ["Crimson Core", "Elder Dragon"], "Crimson Core steals Elder Dragon and starts the match-winning push.", 0.98, 0.98, ["Turning point", "Objective control"]],
      ],
    },
    {
      sessionId: DEMO_SESSION_IDS.concert,
      title: DEMO_SESSION_TITLES.concert,
      domain: "concert",
      sourceLabel: `${DEMO_DATA_LABEL} - Concert livestream`,
      startedAt: "2026-07-26T12:00:00.000Z",
      durationSeconds: 4_800,
      summary: "Aria Nova moved from a restrained opening into a full-band finale, with the audience singalong becoming the defining moment of the set.",
      events: [
        [240, "opening_song", ["Aria Nova", "Main stage"], "Aria Nova begins the set alone under a single spotlight.", 0.35, 0.93, ["Set highlight"]],
        [1_200, "band_joins", ["Aria Nova", "The Horizon Band"], "The Horizon Band joins as the arrangement expands.", 0.55, 0.92, ["Set highlight"]],
        [2_400, "audience_singalong", ["Aria Nova"], "The crowd carries the chorus while Aria Nova pauses at centre stage.", 0.72, 0.95, ["Audience reaction"]],
        [3_600, "encore", ["Aria Nova", "The Horizon Band"], "The performers return for an unannounced encore.", 0.88, 0.96, ["Audience reaction"]],
        [4_560, "finale", ["Aria Nova", "The Horizon Band", "Main stage"], "Lights sweep across the venue during the final sustained note.", 0.98, 0.97, ["Audience reaction", "Set highlight"]],
      ],
    },
    {
      sessionId: DEMO_SESSION_IDS.productLaunch,
      title: DEMO_SESSION_TITLES.productLaunch,
      domain: "product launch",
      sourceLabel: `${DEMO_DATA_LABEL} - Product keynote`,
      startedAt: "2026-07-25T08:00:00.000Z",
      durationSeconds: 3_600,
      summary: "Nova Labs progressed from its design story to the Nova One reveal, then confirmed the price and availability after a live camera demonstration.",
      events: [
        [180, "keynote_opened", ["Nova Labs", "Maya Chen"], "Maya Chen opens the keynote with Nova Labs' accessibility goals.", 0.35, 0.95, ["Product reveal"]],
        [900, "design_preview", ["Nova One", "Maya Chen"], "A silhouette previews the Nova One hardware design.", 0.55, 0.92, ["Product reveal"]],
        [1_800, "product_revealed", ["Nova Labs", "Nova One"], "The Nova One device rises into view at the centre of the stage.", 0.72, 0.97, ["Audience reaction"]],
        [2_700, "live_demo", ["Nova One", "Maya Chen"], "Maya Chen demonstrates the camera's real-time scene description.", 0.88, 0.96, ["Audience reaction"]],
        [3_420, "availability_announced", ["Nova Labs", "Nova One"], "Nova Labs confirms the price and regional release date.", 0.98, 0.98, ["Audience reaction", "Product reveal"]],
      ],
    },
    {
      sessionId: DEMO_SESSION_IDS.creator,
      title: DEMO_SESSION_TITLES.creator,
      domain: "creator livestream",
      sourceLabel: `${DEMO_DATA_LABEL} - Creator livestream`,
      startedAt: "2026-07-24T14:00:00.000Z",
      durationSeconds: 7_200,
      summary: "Mina Park's community build developed from planning into a successful launch, with Build Crew collaboration and live chat decisions shaping the final result.",
      events: [
        [360, "stream_started", ["Mina Park", "Community chat"], "Mina Park introduces the community accessibility build.", 0.35, 0.94, ["Live collaboration"]],
        [1_800, "design_selected", ["Mina Park", "Community chat"], "Community chat votes for the tactile controller design.", 0.55, 0.93, ["Audience reaction"]],
        [3_600, "guest_joined", ["Build Crew", "Mina Park"], "Build Crew joins the stream to assemble the prototype.", 0.72, 0.95, ["Live collaboration"]],
        [5_400, "prototype_tested", ["Build Crew", "Community chat"], "The first prototype responds correctly during a live test.", 0.88, 0.96, ["Audience reaction"]],
        [6_840, "project_completed", ["Mina Park", "Build Crew", "Community chat"], "The finished controller launches as chat celebrates the result.", 0.98, 0.98, ["Audience reaction", "Live collaboration"]],
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
    [DEMO_SESSION_IDS.sports, "counterattack", 0.91],
    [DEMO_SESSION_IDS.esports, "teamfight", 0.88],
    [DEMO_SESSION_IDS.concert, "audience_singalong", 0.86],
    [DEMO_SESSION_IDS.productLaunch, "product_revealed", 0.89],
    [DEMO_SESSION_IDS.creator, "prototype_tested", 0.87],
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
