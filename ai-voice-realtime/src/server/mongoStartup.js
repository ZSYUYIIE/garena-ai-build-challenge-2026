export class MongoStartupError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "MongoStartupError";
  }
}

export async function resolveMongoInfrastructure({
  historyMode,
  mongoUri,
  connect,
  close = async () => {},
  warn = () => {},
}) {
  const configured = Boolean(mongoUri?.trim());
  if (!configured) {
    if (historyMode === "mongodb") {
      throw new MongoStartupError(
        "MongoDB connection failed: MONGODB_URI is required when STREAMSENSE_HISTORY_MODE=mongodb.",
      );
    }
    return null;
  }

  try {
    return await connect();
  } catch (error) {
    await Promise.resolve(close()).catch(() => {});
    const reason = describeMongoConnectionFailure(error);
    if (historyMode === "mongodb") {
      throw new MongoStartupError(
        `MongoDB connection failed: ${reason}`,
        { cause: error },
      );
    }
    warn(
      `MongoDB connection unavailable: ${reason} Continuing with empty, non-durable Memory history.`,
    );
    return null;
  }
}

export function describeMongoConnectionFailure(error) {
  const code = String(error?.code ?? error?.cause?.code ?? "").toUpperCase();
  const codeName = String(error?.codeName ?? "").toLowerCase();
  const name = String(error?.name ?? "").toLowerCase();
  const syscall = String(error?.syscall ?? error?.cause?.syscall ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();

  if (
    ["ENOTFOUND", "ENODATA", "EAI_AGAIN"].includes(code) ||
    syscall.includes("querysrv") ||
    syscall.includes("querytxt") ||
    message.includes("querysrv") ||
    message.includes("querytxt")
  ) {
    return "DNS/SRV lookup failed. Check DNS/network access and the Atlas cluster hostname.";
  }

  if (
    code === "18" ||
    codeName.includes("authentication") ||
    message.includes("authentication failed") ||
    message.includes("bad auth")
  ) {
    return "authentication failed. Check the Atlas database username and password.";
  }

  if (
    ["ETIMEDOUT", "ECONNREFUSED", "ECONNRESET"].includes(code) ||
    name.includes("serverselection") ||
    name.includes("network")
  ) {
    return "the connection timed out or was refused. Check Atlas Network Access/IP allowlisting and firewall connectivity.";
  }

  if (
    code.includes("CERT") ||
    code.includes("TLS") ||
    message.includes("certificate") ||
    message.includes("tls")
  ) {
    return "TLS validation failed. Check the system clock, certificates, and Atlas connection options.";
  }

  return "connection setup failed. Check the Atlas URI structure, database credentials, network access, and cluster availability.";
}

export function safeBackendStartupMessage(error) {
  if (error instanceof MongoStartupError) return error.message;
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = raw
    .replace(/mongodb(?:\+srv)?:\/\/[^\s]+/giu, "[redacted MongoDB URI]")
    .replace(/:\/\/[^\s/@:]+:[^\s/@]+@/gu, "://[redacted]@");
  return `StreamSense backend startup failed: ${redacted}`;
}
