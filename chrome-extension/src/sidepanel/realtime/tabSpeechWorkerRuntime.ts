import type { SileroSpeechModel } from "./sileroV5.ts";
import {
  parseTabSpeechWorkerCommand,
  type TabSpeechWorkerCommand,
  type TabSpeechWorkerEvent,
} from "./tabSpeechWorkerProtocol.ts";

export type WorkerRuntimeDependencies = {
  loadModel(): Promise<SileroSpeechModel>;
  postEvent(event: TabSpeechWorkerEvent): void;
  now(): number;
  closeWorker(): void;
};

export function createTabSpeechWorkerRuntime(dependencies: WorkerRuntimeDependencies) {
  let generation = 0;
  let model: SileroSpeechModel | null = null;
  let work = Promise.resolve();
  let failed = false;
  let closed = false;

  async function closeModel(): Promise<void> {
    const closing = model;
    model = null;
    if (closing) await closing.close();
  }

  async function handle(command: TabSpeechWorkerCommand): Promise<void> {
    if (closed) return;
    if (command.type === "initialize") {
      generation = command.generation;
      failed = false;
      await closeModel();
      model = await dependencies.loadModel();
      dependencies.postEvent({ type: "ready", generation });
      return;
    }
    if (command.generation !== generation) return;
    if (command.type === "close") {
      closed = true;
      await closeModel();
      dependencies.closeWorker();
      return;
    }
    if (failed || !model) return;
    if (command.type === "reset") {
      model.reset();
      return;
    }
    const startedAt = dependencies.now();
    const probability = await model.process(new Float32Array(command.pcm));
    dependencies.postEvent({
      type: "probability",
      generation,
      sequence: command.sequence,
      frameEndMs: command.frameEndMs,
      probability,
      inferenceMs: Math.max(0, dependencies.now() - startedAt),
    });
  }

  function receive(value: unknown): Promise<void> {
    work = work.then(async () => {
      let stage: "initialize" | "inference" = "inference";
      try {
        const command = parseTabSpeechWorkerCommand(value);
        stage = command.type === "initialize" ? "initialize" : "inference";
        await handle(command);
      } catch {
        failed = true;
        try { await closeModel(); } catch { /* isolated worker will be terminated */ }
        if (generation > 0) dependencies.postEvent({ type: "failed", generation, stage });
      }
    });
    return work;
  }

  return { receive };
}
