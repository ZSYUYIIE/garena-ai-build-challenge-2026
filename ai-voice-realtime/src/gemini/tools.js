export const RECORD_EVENT_TOOL_NAME = "record_event";

export const structuredEventTool = {
  functionDeclarations: [
    {
      name: RECORD_EVENT_TOOL_NAME,
      description:
        "Record one meaningful visual event from the current livestream frame. " +
        "Do not call this for unchanged scenes or routine motion.",
      parameters: {
        type: "OBJECT",
        properties: {
          eventType: {
            type: "STRING",
            description:
              "A concise lowercase snake_case category such as shot_saved or player_substitution.",
          },
          entities: {
            type: "ARRAY",
            items: { type: "STRING" },
            description:
              "Named teams, players, performers, products, or other relevant entities.",
          },
          description: {
            type: "STRING",
            description:
              "A concise, factual description of what visibly happened.",
          },
          importance: {
            type: "NUMBER",
            description:
              "How important this moment is to the stream, from 0 to 1.",
          },
          confidence: {
            type: "NUMBER",
            description:
              "Confidence that the event is visually supported, from 0 to 1.",
          },
        },
        required: [
          "eventType",
          "entities",
          "description",
          "importance",
          "confidence",
        ],
      },
    },
  ],
};

export function extractFunctionCalls(message) {
  const functionCalls =
    message.toolCall?.functionCalls ||
    message.tool_call?.function_calls ||
    [];

  return functionCalls
    .filter((call) => call && typeof call.name === "string")
    .map((call) => ({
      id: call.id,
      name: call.name,
      args: call.args || {},
    }));
}

export function buildToolResponse(call, response) {
  return {
    toolResponse: {
      functionResponses: [
        {
          ...(call.id ? { id: call.id } : {}),
          name: call.name,
          response,
        },
      ],
    },
  };
}
