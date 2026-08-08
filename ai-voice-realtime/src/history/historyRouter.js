import express from "express";
import { z } from "zod";

import { semanticSearchInputSchema } from "./historySchemas.js";

const uuidSchema = z.uuid();
const cursorSchema = z.string().min(1).max(2_000).optional();
const eventTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)
  .optional();

const sessionListQuerySchema = z
  .object({
    limit: queryInteger(12, 1, 50),
    cursor: cursorSchema,
  })
  .strict();

const eventListQuerySchema = z
  .object({
    limit: queryInteger(50, 1, 100),
    cursor: cursorSchema,
    eventType: eventTypeSchema,
    eventId: z.uuid().optional(),
  })
  .strict();

const graphQuerySchema = z
  .object({
    sessionId: z.uuid().optional(),
    domain: z.string().trim().min(1).max(80).optional(),
    query: z.string().trim().min(1).max(500).optional(),
    limit: queryInteger(80, 1, 200),
  })
  .strict();

export function createHistoryRouter({ historyService }) {
  if (!historyService) throw new TypeError("createHistoryRouter requires historyService");
  const router = express.Router();

  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    response.set("X-Content-Type-Options", "nosniff");
    next();
  });

  router.get("/sessions", asyncRoute(async (request, response) => {
    const query = sessionListQuerySchema.parse(request.query);
    response.json(await historyService.listSessions(query));
  }));

  router.get("/sessions/:sessionId/events", asyncRoute(async (request, response) => {
    const sessionId = uuidSchema.parse(request.params.sessionId);
    const query = eventListQuerySchema.parse(request.query);
    const result = await historyService.listSessionEvents(sessionId, query);
    if (!result) return sendNotFound(response, "SESSION_NOT_FOUND", "The requested session was not found.");
    response.json(result);
  }));

  router.get("/sessions/:sessionId", asyncRoute(async (request, response) => {
    const sessionId = uuidSchema.parse(request.params.sessionId);
    const result = await historyService.getSession(sessionId);
    if (!result) return sendNotFound(response, "SESSION_NOT_FOUND", "The requested session was not found.");
    response.json(result);
  }));

  router.post(
    "/search",
    (request, response, next) => {
      if (!request.is("application/json")) {
        response.status(415).json({
          error: {
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: "History search requires an application/json request body.",
          },
        });
        return;
      }
      next();
    },
    express.json({ limit: "16kb", type: "application/json" }),
    asyncRoute(async (request, response) => {
      const input = semanticSearchInputSchema.parse(request.body);
      response.json(await historyService.searchSimilarEvents(input));
    }),
  );

  router.get("/context-graph", asyncRoute(async (request, response) => {
    const query = graphQuerySchema.parse(request.query);
    if (query.sessionId && !(await historyService.getSession(query.sessionId))) {
      return sendNotFound(response, "SESSION_NOT_FOUND", "The requested session was not found.");
    }
    response.json(await historyService.getContextGraph(query));
  }));

  router.use((_request, response) => {
    response.status(404).json({
      error: { code: "API_NOT_FOUND", message: "The requested history endpoint was not found." },
    });
  });

  router.use((error, _request, response, _next) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: summarizeZodError(error),
        },
      });
      return;
    }
    if (error?.code === "INVALID_CURSOR") {
      response.status(400).json({
        error: { code: "INVALID_CURSOR", message: error.message },
      });
      return;
    }
    if (error?.type === "entity.too.large") {
      response.status(413).json({
        error: {
          code: "REQUEST_TOO_LARGE",
          message: "The request body exceeds the 16 KB history API limit.",
        },
      });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json({
        error: { code: "INVALID_JSON", message: "The request body must be valid JSON." },
      });
      return;
    }
    if (error?.type === "charset.unsupported" || error?.status === 415) {
      response.status(415).json({
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "History search requires an application/json request body.",
        },
      });
      return;
    }
    response.status(500).json({
      error: {
        code: "HISTORY_UNAVAILABLE",
        message: "StreamSense history is temporarily unavailable.",
      },
    });
  });

  return router;
}

function queryInteger(fallback, minimum, maximum) {
  return z.preprocess(
    (value) => value === undefined ? fallback : Number(value),
    z.number().int().min(minimum).max(maximum),
  );
}

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function sendNotFound(response, code, message) {
  return response.status(404).json({ error: { code, message } });
}

function summarizeZodError(error) {
  return error.issues
    .slice(0, 3)
    .map((issue) => {
      const field = issue.path.length ? issue.path.join(".") : "request";
      return `${field}: ${issue.message}`;
    })
    .join("; ")
    .slice(0, 500);
}
