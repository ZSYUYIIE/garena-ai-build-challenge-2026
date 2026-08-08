import { z } from "zod";

export const dataOriginSchema = z
  .enum(["demo", "realtime", "mixed", "empty"])
  .nullable();

export type DataOrigin = z.infer<typeof dataOriginSchema>;

export const responseMetaSchema = z
  .object({
    dataOrigin: dataOriginSchema,
  })
  .strict();

const isoDateTimeSchema = z.string().datetime({ offset: true });
const scoreSchema = z.number().finite().min(0).max(1);

export const sessionSchema = z
  .object({
    sessionId: z.uuid(),
    startedAt: isoDateTimeSchema,
    endedAt: isoDateTimeSchema.nullable(),
    durationSeconds: z.number().finite().nonnegative(),
    title: z.string().trim().min(1).max(200),
    domain: z.string().trim().min(1).max(80),
    sourceLabel: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(2_000),
    eventCount: z.number().int().nonnegative(),
    importantEventCount: z.number().int().nonnegative(),
    entities: z.array(z.string().trim().min(1).max(120)).max(100),
    topics: z.array(z.string().trim().min(1).max(120)).max(100),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export type Session = z.infer<typeof sessionSchema>;

export const historyEventSchema = z
  .object({
    id: z.uuid(),
    sessionId: z.uuid(),
    timestampSeconds: z.number().finite().nonnegative(),
    timestamp: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
    eventType: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/),
    entities: z.array(z.string().trim().min(1).max(120)).max(20),
    description: z.string().trim().min(1).max(500),
    importance: scoreSchema,
    confidence: scoreSchema,
    createdAt: isoDateTimeSchema,
    topicLabels: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  })
  .strict();

export type HistoryEvent = z.infer<typeof historyEventSchema>;

const cursorSchema = z.string().min(1).max(2_000).nullable();

export const sessionListResponseSchema = z
  .object({
    meta: responseMetaSchema,
    sessions: z.array(sessionSchema),
    nextCursor: cursorSchema,
  })
  .strict();

export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;

export const sessionDetailResponseSchema = z
  .object({
    meta: responseMetaSchema,
    session: sessionSchema,
  })
  .strict();

export type SessionDetailResponse = z.infer<
  typeof sessionDetailResponseSchema
>;

export const sessionEventsResponseSchema = z
  .object({
    meta: responseMetaSchema,
    events: z.array(historyEventSchema),
    nextCursor: cursorSchema,
  })
  .strict();

export type SessionEventsResponse = z.infer<
  typeof sessionEventsResponseSchema
>;

export const searchRequestSchema = z
  .object({
    query: z.string().trim().min(2).max(500),
    sessionId: z.uuid().optional(),
    domain: z.string().trim().min(1).max(80).optional(),
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict();

export type SearchRequest = z.infer<typeof searchRequestSchema>;

export const searchResultSchema = z
  .object({
    sessionId: z.uuid(),
    sessionTitle: z.string().trim().min(1).max(200).optional(),
    eventId: z.uuid(),
    timestampSeconds: z.number().finite().nonnegative(),
    timestamp: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
    eventType: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    entities: z.array(z.string().trim().min(1).max(120)).max(20),
    topics: z.array(z.string().trim().min(1).max(120)).max(20),
    similarity: scoreSchema.nullable(),
  })
  .strict();

export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z
  .object({
    meta: responseMetaSchema,
    results: z.array(searchResultSchema).max(50),
    retrievalMode: z.enum(["semantic", "text", "unavailable"]),
    warning: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const graphNodeSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    type: z.enum(["session", "event", "entity", "topic"]),
    label: z.string().trim().min(1).max(240),
    sessionId: z.uuid().optional(),
    eventId: z.uuid().optional(),
    importance: scoreSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    source: z.string().trim().min(1).max(240),
    target: z.string().trim().min(1).max(240),
    type: z.enum([
      "semantic_similarity",
      "shared_entity",
      "same_session",
      "temporal_relation",
      "shared_topic",
    ]),
    weight: scoreSchema,
  })
  .strict();

export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const contextGraphResponseSchema = z
  .object({
    meta: responseMetaSchema,
    nodes: z.array(graphNodeSchema).max(200),
    edges: z.array(graphEdgeSchema).max(600),
  })
  .strict();

export type ContextGraphResponse = z.infer<
  typeof contextGraphResponseSchema
>;

export const errorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().trim().min(1).max(120),
        message: z.string().trim().min(1).max(500),
      })
      .strict(),
  })
  .strict();
