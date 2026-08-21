export type TabSpeechWorkerCommand =
  | { type: "initialize"; generation: number }
  | { type: "frame"; generation: number; sequence: number; frameEndMs: number; pcm: ArrayBuffer }
  | { type: "reset"; generation: number }
  | { type: "close"; generation: number };

export type TabSpeechWorkerEvent =
  | { type: "ready"; generation: number }
  | { type: "probability"; generation: number; sequence: number; frameEndMs: number; probability: number; inferenceMs: number }
  | { type: "failed"; generation: number; stage: "initialize" | "inference" };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonnegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function commandError(): never {
  throw new TypeError("Invalid tab speech worker command.");
}

function eventError(): never {
  throw new TypeError("Invalid tab speech worker event.");
}

export function parseTabSpeechWorkerCommand(value: unknown): TabSpeechWorkerCommand {
  if (!isRecord(value) || typeof value.type !== "string") commandError();
  if (value.type === "initialize" || value.type === "reset" || value.type === "close") {
    if (!hasExactKeys(value, ["type", "generation"]) || !isPositiveSafeInteger(value.generation)) commandError();
    return value as TabSpeechWorkerCommand;
  }
  if (value.type === "frame") {
    if (
      !hasExactKeys(value, ["type", "generation", "sequence", "frameEndMs", "pcm"])
      || !isPositiveSafeInteger(value.generation)
      || !isPositiveSafeInteger(value.sequence)
      || !isNonnegativeFinite(value.frameEndMs)
      || !(value.pcm instanceof ArrayBuffer)
      || value.pcm.byteLength !== 2_048
    ) commandError();
    return value as TabSpeechWorkerCommand;
  }
  return commandError();
}

export function parseTabSpeechWorkerEvent(value: unknown): TabSpeechWorkerEvent {
  if (!isRecord(value) || typeof value.type !== "string") eventError();
  if (value.type === "ready") {
    if (!hasExactKeys(value, ["type", "generation"]) || !isPositiveSafeInteger(value.generation)) eventError();
    return value as TabSpeechWorkerEvent;
  }
  if (value.type === "failed") {
    if (
      !hasExactKeys(value, ["type", "generation", "stage"])
      || !isPositiveSafeInteger(value.generation)
      || (value.stage !== "initialize" && value.stage !== "inference")
    ) eventError();
    return value as TabSpeechWorkerEvent;
  }
  if (value.type === "probability") {
    if (
      !hasExactKeys(value, ["type", "generation", "sequence", "frameEndMs", "probability", "inferenceMs"])
      || !isPositiveSafeInteger(value.generation)
      || !isPositiveSafeInteger(value.sequence)
      || !isNonnegativeFinite(value.frameEndMs)
      || !isNonnegativeFinite(value.inferenceMs)
      || typeof value.probability !== "number"
      || !Number.isFinite(value.probability)
      || value.probability < 0
      || value.probability > 1
    ) eventError();
    return value as TabSpeechWorkerEvent;
  }
  return eventError();
}
