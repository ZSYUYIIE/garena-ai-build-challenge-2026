import { z } from "zod";

export const ContextSchema = z.object({
  sessionId: z.string().uuid(),
  timestampSeconds: z.number().finite().nonnegative(),
  eventType: z.string().trim().min(1).max(80),
  entities: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  description: z.string().trim().min(1).max(500),
  importance: z.number().finite().min(0).max(1),
  confidence: z.number().finite().min(0).max(1),
  embedding: z.array(z.number()).length(768),
});
