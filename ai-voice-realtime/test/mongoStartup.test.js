import assert from "node:assert/strict";
import test from "node:test";

import {
  MongoStartupError,
  describeMongoConnectionFailure,
  resolveMongoInfrastructure,
  safeBackendStartupMessage,
} from "../src/server/mongoStartup.js";

test("auto mode degrades to empty Memory with a sanitized actionable warning", async () => {
  const warnings = [];
  let closed = 0;
  const result = await resolveMongoInfrastructure({
    historyMode: "auto",
    mongoUri: "mongodb+srv://example.invalid/",
    connect: async () => {
      const error = new Error(
        "querySrv ECONNREFUSED _mongodb._tcp.example.invalid",
      );
      error.code = "ECONNREFUSED";
      error.syscall = "querySrv";
      throw error;
    },
    close: async () => {
      closed += 1;
    },
    warn: (message) => warnings.push(message),
  });

  assert.equal(result, null);
  assert.equal(closed, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /DNS\/SRV lookup failed/i);
  assert.match(warnings[0], /non-durable Memory history/i);
  assert.doesNotMatch(warnings[0], /mongodb\+srv|example\.invalid/i);
});

test("explicit mongodb mode fails early without exposing connection details", async () => {
  await assert.rejects(
    resolveMongoInfrastructure({
      historyMode: "mongodb",
      mongoUri: "mongodb+srv://example.invalid/",
      connect: async () => {
        const error = new Error("Authentication failed for configured MongoDB deployment");
        error.code = 18;
        error.codeName = "AuthenticationFailed";
        throw error;
      },
    }),
    (error) => {
      assert.ok(error instanceof MongoStartupError);
      assert.match(error.message, /MongoDB connection failed: authentication failed/i);
      assert.doesNotMatch(error.message, /mongodb\+srv|example\.invalid/i);
      return true;
    },
  );
});

test("explicit mongodb mode reports a missing URI directly", async () => {
  await assert.rejects(
    resolveMongoInfrastructure({
      historyMode: "mongodb",
      mongoUri: "",
      connect: async () => assert.fail("connect must not run"),
    }),
    /MONGODB_URI is required/i,
  );
});

test("successful Mongo startup returns the durable infrastructure", async () => {
  const infrastructure = { provider: "mongodb" };
  assert.equal(
    await resolveMongoInfrastructure({
      historyMode: "auto",
      mongoUri: "mongodb://localhost:27017",
      connect: async () => infrastructure,
    }),
    infrastructure,
  );
});

test("startup diagnostics classify common failures and redact unknown URIs", () => {
  assert.match(
    describeMongoConnectionFailure({ name: "MongoServerSelectionError" }),
    /timed out or was refused/i,
  );
  assert.match(
    describeMongoConnectionFailure({ code: "CERT_HAS_EXPIRED" }),
    /TLS validation failed/i,
  );
  const message = safeBackendStartupMessage(
    new Error(
      "failed for mongodb+srv://example.invalid/?appName=StreamSense",
    ),
  );
  assert.match(message, /StreamSense backend startup failed/i);
  assert.match(message, /redacted MongoDB URI/i);
  assert.doesNotMatch(message, /example\.invalid|appName/i);
});
