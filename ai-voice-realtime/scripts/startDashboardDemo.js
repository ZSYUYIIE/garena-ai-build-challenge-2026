if (process.env.NODE_ENV === "production") {
  throw new Error("Dashboard demo mode is disabled when NODE_ENV=production.");
}

process.env.STREAMSENSE_HISTORY_MODE = "demo";
await import("../server.js");
