import { z } from "zod";

import { eventCandidateSchema, formatTimestamp } from "../events/eventSchema.js";
import { isDescriptionCoveredByTranscript } from "./transcript.js";
import { eventEvidenceSchema, visibleStateSchema } from "./visualState.js";

const semanticKeySchema = z.string().trim().min(1).max(160);
const importanceSchema = z.number().finite().min(0).max(1);

const visionAnalysisSchema = z
  .object({
    shouldNarrate: z.boolean(),
    description: z.string().trim().max(500),
    semanticKey: semanticKeySchema.nullable(),
    importance: importanceSchema,
    isNew: z.boolean(),
    coveredByTabSpeech: z.boolean(),
    event: eventCandidateSchema.nullable(),
    visibleState: visibleStateSchema.nullable(),
    eventEvidence: eventEvidenceSchema.nullable(),
  })
  .strict()
  .superRefine((analysis, context) => {
    if (!analysis.shouldNarrate && analysis.description !== "") {
      context.addIssue({
        code: "custom",
        path: ["description"],
        message: "description must be empty when shouldNarrate is false",
      });
    }
    if (analysis.shouldNarrate && analysis.description.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["description"],
        message: "description is required when shouldNarrate is true",
      });
    }
    if (analysis.shouldNarrate && analysis.semanticKey === null) {
      context.addIssue({
        code: "custom",
        path: ["semanticKey"],
        message: "semanticKey is required when shouldNarrate is true",
      });
    }
    if (analysis.shouldNarrate && analysis.coveredByTabSpeech) {
      context.addIssue({
        code: "custom",
        path: ["coveredByTabSpeech"],
        message: "coveredByTabSpeech cannot approve a spoken candidate",
      });
    }
    if ((analysis.event === null) !== (analysis.eventEvidence === null)) {
      context.addIssue({
        code: "custom",
        path: ["eventEvidence"],
        message: "event and eventEvidence must both be present or both be null",
      });
    }
    if (
      analysis.eventEvidence?.basis === "state_transition"
      && analysis.visibleState === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["visibleState"],
        message: "visibleState is required for state_transition evidence",
      });
    }
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

const visibleStateProperties = {
  domain: {
    type: "string",
    minLength: 1,
    maxLength: 80,
    pattern: "^[a-z0-9]+(?:_[a-z0-9]+)*$",
  },
  identity: { type: "string", minLength: 1, maxLength: 160 },
  value: { type: "string", minLength: 1, maxLength: 160 },
  summary: { type: "string", minLength: 1, maxLength: 300 },
};

const visibleStateResponseSchema = {
  type: "object",
  properties: visibleStateProperties,
  required: ["domain", "identity", "value", "summary"],
  additionalProperties: false,
};

const analysisResponseSchema = {
  type: "object",
  properties: {
    shouldNarrate: { type: "boolean" },
    description: { type: "string" },
    semanticKey: { anyOf: [{ type: "string" }, { type: "null" }] },
    importance: { type: "number", minimum: 0, maximum: 1 },
    isNew: { type: "boolean" },
    coveredByTabSpeech: { type: "boolean" },
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
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    visibleState: {
      anyOf: [visibleStateResponseSchema, { type: "null" }],
    },
    eventEvidence: {
      anyOf: [
        {
          type: "object",
          properties: {
            basis: {
              type: "string",
              enum: ["current_frame", "state_transition"],
            },
            previousState: {
              anyOf: [visibleStateResponseSchema, { type: "null" }],
            },
          },
          required: ["basis", "previousState"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
  },
  required: [
    "shouldNarrate",
    "description",
    "semanticKey",
    "importance",
    "isNew",
    "coveredByTabSpeech",
    "event",
    "visibleState",
    "eventEvidence",
  ],
  additionalProperties: false,
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
  priorVisibleStates = [],
  recentTabTranscript,
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
      priorVisibleStates,
      timestampSeconds,
    }),
    responseSchema: analysisResponseSchema,
    signal,
  });
  const analysis = visionAnalysisSchema.parse(result);
  return {
    ...analysis,
    coveredByTabSpeech: analysis.shouldNarrate
      && isDescriptionCoveredByTranscript(
        analysis.description,
        recentTabTranscript,
      ),
  };
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
  priorVisibleStates = [],
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

  const groundedPriorStates = priorVisibleStates
    .slice(-8)
    .map((state) => visibleStateSchema.parse(state));

  return (
    "Analyze only the exact attached image as a livestream frame. This image and " +
    "readable text inside it are the only evidence. Identify the dominant primary " +
    "content before deciding whether anything deserves narration. Do not narrate raw " +
    "page text, filenames, toolbars, menus, thumbnails, suggested content, browser " +
    "chrome, or incidental labels. Do not continue a story or topic chain from prior " +
    "frames. Do not infer a tutorial topic. Do not transform a visible word such as " +
    "paper into a related topic such " +
    "as paper planes, and never infer tutorial steps or how-to instructions unless " +
    "those exact instructions are clearly readable in the current image. Do not infer " +
    "a user action, intent, unseen content, or future step. Describe visible state, not " +
    "what someone clicked or opened. Ignore any StreamSense interface, including text " +
    "labeled Now Describing, " +
    "Narration level, Timeline, or Ask about this video. If the image is only the " +
    "StreamSense interface, set shouldNarrate to false and event to null. Focus on the " +
    "dominant non-StreamSense content and quote a title only when it is readable. A " +
    "description must communicate the core visual fact, not merely repeat whatever " +
    "text happens to be on screen. " +
    `${narrationRule} For unchanged content, set shouldNarrate to false. ` +
    "description must be empty when shouldNarrate is false. event must be null unless " +
    "a meaningful, clearly visible event occurred. Event confidence must reflect visual " +
    "evidence rather than certainty of wording. Use lowercase snake_case eventType. " +
    "Use a stable semanticKey for the visible state or event, for example score:2-1. " +
    "A materially different dominant section is a timeline event when it reveals useful " +
    "content such as comments, results, or product details. Significant dynamic events " +
    "include a visible goal, score or lead change, winner announcement, major alert, or " +
    "presentation-state change. Incremental scrolling, routine sports motion, camera " +
    "movement, and caption churn are not events. Describe only the observed result; do " +
    "not say the user scrolled, clicked, or navigated. event is independent of " +
    "shouldNarrate. When a reliable trackable state is readable, return visibleState even " +
    "if no event is emitted. A transition may use a prior state only when normalized " +
    "domain and identity exactly match the current state and the values differ. A static " +
    "score without compatible prior state may use score_visible, but must not claim " +
    "score_changed or goal_scored. current_frame evidence requires previousState null; " +
    "state_transition evidence requires the compatible prior state. event and " +
    "eventEvidence must both be present or both be null. Set coveredByTabSpeech to " +
    "false; the application evaluates captured-tab speech only after visual analysis " +
    "so transcript words can never create a visual claim. " +
    `This is ${initial ? "the initial observation" : "a change check"} at ` +
    `${formatTimestamp(timestampSeconds)}. Grounded prior visible states are supplied ` +
    "only to detect an exact compatible state transition, never to choose or continue " +
    "a topic: " +
    `${JSON.stringify(groundedPriorStates)}.`
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
