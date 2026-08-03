import test from "node:test";
import assert from "node:assert/strict";

import {
  buildToolResponse,
  extractFunctionCalls,
  RECORD_EVENT_TOOL_NAME,
} from "../src/gemini/tools.js";

test("extractFunctionCalls reads Gemini Live tool calls", () => {
  const calls = extractFunctionCalls({
    toolCall: {
      functionCalls: [
        {
          id: "call-1",
          name: RECORD_EVENT_TOOL_NAME,
          args: { eventType: "shot_saved" },
        },
      ],
    },
  });

  assert.deepEqual(calls, [
    {
      id: "call-1",
      name: RECORD_EVENT_TOOL_NAME,
      args: { eventType: "shot_saved" },
    },
  ]);
});

test("buildToolResponse preserves the Gemini call id", () => {
  assert.deepEqual(
    buildToolResponse(
      { id: "call-1", name: RECORD_EVENT_TOOL_NAME },
      { accepted: true, status: "recorded" }
    ),
    {
      toolResponse: {
        functionResponses: [
          {
            id: "call-1",
            name: RECORD_EVENT_TOOL_NAME,
            response: { accepted: true, status: "recorded" },
          },
        ],
      },
    }
  );
});
