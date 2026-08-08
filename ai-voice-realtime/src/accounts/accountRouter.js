import express from "express";
import { z } from "zod";

import { accountDraftSchema } from "./accountSchemas.js";

const accountIdSchema = z.uuid();

export function createAccountRouter({ accountRepository }) {
  if (!accountRepository) {
    throw new TypeError("createAccountRouter requires accountRepository");
  }
  const router = express.Router();

  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    response.set("X-Content-Type-Options", "nosniff");
    next();
  });

  router.get("/:accountId", asyncRoute(async (request, response) => {
    const accountId = accountIdSchema.parse(request.params.accountId);
    const account = await accountRepository.getAccount(accountId);
    if (!account) return sendNotFound(response);
    response.json({ account });
  }));

  router.post(
    "/",
    requireJson,
    express.json({ limit: "8kb", type: "application/json" }),
    asyncRoute(async (request, response) => {
      const account = await accountRepository.createAccount(
        accountDraftSchema.parse(request.body),
      );
      response.status(201).json({ account });
    }),
  );

  router.put(
    "/:accountId",
    requireJson,
    express.json({ limit: "8kb", type: "application/json" }),
    asyncRoute(async (request, response) => {
      const accountId = accountIdSchema.parse(request.params.accountId);
      const account = await accountRepository.updateAccount(
        accountId,
        accountDraftSchema.parse(request.body),
      );
      if (!account) return sendNotFound(response);
      response.json({ account });
    }),
  );

  router.use((_request, response) => {
    response.status(404).json({
      error: { code: "API_NOT_FOUND", message: "The requested account endpoint was not found." },
    });
  });

  router.use((error, _request, response, _next) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({
        error: { code: "INVALID_REQUEST", message: summarizeZodError(error) },
      });
      return;
    }
    if (error?.code === "ACCOUNT_EMAIL_EXISTS") {
      response.status(409).json({
        error: { code: "ACCOUNT_EMAIL_EXISTS", message: error.message },
      });
      return;
    }
    if (error?.code === "ACCOUNT_STORAGE_UNAVAILABLE") {
      response.status(503).json({
        error: {
          code: "ACCOUNT_STORAGE_UNAVAILABLE",
          message: "MongoDB account storage is not configured on this server.",
        },
      });
      return;
    }
    if (error?.type === "entity.too.large") {
      response.status(413).json({
        error: { code: "REQUEST_TOO_LARGE", message: "The account request exceeds 8 KB." },
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
        error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Account writes require application/json." },
      });
      return;
    }
    response.status(500).json({
      error: { code: "ACCOUNT_STORAGE_ERROR", message: "Account storage is temporarily unavailable." },
    });
  });

  return router;
}

function requireJson(request, response, next) {
  if (!request.is("application/json")) {
    response.status(415).json({
      error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Account writes require application/json." },
    });
    return;
  }
  next();
}

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function sendNotFound(response) {
  return response.status(404).json({
    error: { code: "ACCOUNT_NOT_FOUND", message: "The requested account was not found." },
  });
}

function summarizeZodError(error) {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
    .join("; ")
    .slice(0, 500);
}
