import { z } from "zod";

import { eventCandidateSchema, formatTimestamp } from "../events/eventSchema.js";

const visionAnalysisSchema = z.object({
  shouldNarrate: z.boolean(),
  description: z.string().trim().max(500),
  event: eventCandidateSchema.nullable(),
});

const visionAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(800),
});

const eventProperties = {
  eventType: { type: "string" },
  entities: { type: "array", items: { type: "string" } },
  description: { type: "string" },
  importance: { type: "number" },
  confidence: { type: "number" },
};

const analysisResponseSchema = {
  type: "object",
  properties: {
    shouldNarrate: { type: "boolean" },
    description: { type: "string" },
    event: {
      anyOf: [
        {
          type: "object",
          properties: eventProperties,
          required: [
            "eventType",
            "entities",
            "description",
            "importance",
            "confidence",
          ],
        },
        { type: "null" },
      ],
    },
  },
  required: ["shouldNarrate", "description", "event"],
};

const answerResponseSchema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
};

export async function analyzeVisionFrame({
  apiKey,
  model,
  frame,
  initial,
  narrationLevel,
  previousDescription,
  timestampSeconds,
  signal,
}) {
  const result = await generateJson({
    apiKey,
    model,
    frame,
    prompt: buildAnalysisPrompt({
      initial,
      narrationLevel,
      previousDescription,
      timestampSeconds,
    }),
    responseSchema: analysisResponseSchema,
    signal,
  });
  return visionAnalysisSchema.parse(result);
}

export async function answerVisionQuestion({
  apiKey,
  model,
  frame,
  question,
  recentEvents,
  signal,
}) {
  const memory = recentEvents.length
    ? recentEvents
        .map((event) => `${event.timestamp}: ${event.description}`)
        .join("\n")
    : "No earlier events have been recorded.";
  const result = await generateJson({
    apiKey,
    model,
    frame,
    prompt:
      "Answer the user's question using only the exact attached frame and the " +
      "timestamped session memory below. Prefer the current frame for questions " +
      "about what is visible now. Do not invent names, actions, topics, or details. " +
      "If the evidence is insufficient, say that clearly and briefly.\n\n" +
      `Question: ${question}\n\nSession memory:\n${memory}`,
    responseSchema: answerResponseSchema,
    signal,
  });
  return visionAnswerSchema.parse(result).answer;
}

export function buildAnalysisPrompt({
  initial,
  narrationLevel,
  previousDescription,
  timestampSeconds,
}) {
  const detail =
    narrationLevel === "minimal"
      ? "Use one short clause."
      : narrationLevel === "detailed"
        ? "Use at most two concise sentences with useful spatial detail."
        : "Use one concise sentence.";
  const narrationRule =
    narrationLevel === "question_only"
      ? "Set shouldNarrate to false."
      : `${detail} Set shouldNarrate to true only for a meaningful new visual fact.`;

  return (
    "Analyze only the exact attached image as a livestream frame. This image and " +
    "readable text inside it are the only evidence. Do not continue a story from " +
    "earlier descriptions. Do not infer a tutorial topic, user action, intent, unseen " +
    "content, or future step. Describe visible state, not what someone clicked or " +
    "opened. Ignore any StreamSense interface, including text labeled Now Describing, " +
    "Narration level, Timeline, or Ask about this video. If the image is only the " +
    "StreamSense interface, set shouldNarrate to false and event to null. Focus on the " +
    "dominant non-StreamSense content and quote a title only when it is readable. " +
    `${narrationRule} For unchanged content, set shouldNarrate to false. ` +
    "description must be empty when shouldNarrate is false. event must be null unless " +
    "a meaningful, clearly visible event occurred. Event confidence must reflect visual " +
    "evidence rather than certainty of wording. Use lowercase snake_case eventType. " +
    `This is ${initial ? "the initial observation" : "a change check"} at ` +
    `${formatTimestamp(timestampSeconds)}. Previous grounded description: ` +
    `${previousDescription || "none"}.`
  );
}

async function generateJson({
  apiKey,
  model,
  frame,
  prompt,
  responseSchema,
  signal,
}) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
        "Api-Revision": "2026-05-20",
      },
      body: JSON.stringify({
        model,
        input: [
          { type: "text", text: prompt },
          { type: "image", data: frame.data, mime_type: frame.mimeType },
        ],
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: responseSchema,
        },
        generation_config: {
          max_output_tokens: 512,
          thinking_level: "minimal",
        },
        store: false,
      }),
    }
  );

  const payload = await response.json();
  if (!response.ok) {
    const detail = payload?.error?.message || JSON.stringify(payload);
    throw new Error(`Gemini vision request failed (${response.status}): ${detail}`);
  }

  const text = (payload.steps || [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content || [])
    .filter((content) => content.type === "text")
    .map((content) => content.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("Gemini vision returned no structured result.");
  return JSON.parse(text);
}
