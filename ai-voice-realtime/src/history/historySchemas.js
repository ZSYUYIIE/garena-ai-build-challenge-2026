import { z } from "zod";

import { eventRecordInputSchema, formatTimestamp } from "../events/eventSchema.js";

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const boundedLabelSchema = z.string().trim().min(1).max(120);
const scoreSchema = z.number().finite().min(0).max(1);

export const dataOriginSchema = z.enum(["demo", "realtime"]);

export const historySessionSchema = z
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
    entities: z.array(boundedLabelSchema).max(100),
    topics: z.array(boundedLabelSchema).max(100),
    dataOrigin: dataOriginSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const historyEventSchema = eventRecordInputSchema
  .extend({
    id: z.uuid(),
    timestamp: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
    createdAt: isoDateTimeSchema,
    topicLabels: z.array(boundedLabelSchema).max(20).default([]),
  })
  .strict();

export const semanticSearchInputSchema = z
  .object({
    query: z.string().trim().min(2).max(500),
    sessionId: z.uuid().optional(),
    domain: z.string().trim().min(1).max(80).optional(),
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict();

export const semanticSearchResultSchema = z
  .object({
    sessionId: z.uuid(),
    sessionTitle: z.string().trim().min(1).max(200).optional(),
    eventId: z.uuid(),
    timestampSeconds: z.number().finite().nonnegative(),
    timestamp: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
    eventType: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    entities: z.array(boundedLabelSchema).max(20),
    topics: z.array(boundedLabelSchema).max(20),
    similarity: scoreSchema.nullable(),
  })
  .strict();

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

export function normalizeHistoryEvent(input, {
  createdAt = new Date().toISOString(),
  topicLabels = input.topicLabels ?? [],
} = {}) {
  return historyEventSchema.parse({
    ...input,
    timestamp: formatTimestamp(input.timestampSeconds),
    createdAt: input.createdAt ?? createdAt,
    topicLabels,
  });
}

export function aggregateDataOrigin(items) {
  const origins = new Set(
    items
      .map((item) => item?.dataOrigin)
      .filter((origin) => origin === "demo" || origin === "realtime"),
  );
  if (origins.size === 0) return "empty";
  if (origins.size > 1) return "mixed";
  return origins.values().next().value;
}
