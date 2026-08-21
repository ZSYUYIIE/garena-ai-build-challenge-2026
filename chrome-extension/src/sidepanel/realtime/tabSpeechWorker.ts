import modelUrl from "@ricky0123/vad-web/dist/silero_vad_v5.onnx?url";
import wasmModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

import { loadSileroV5Model } from "./sileroV5.ts";
import { createTabSpeechWorkerRuntime } from "./tabSpeechWorkerRuntime.ts";

type WorkerScope = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: unknown): void;
  close(): void;
};

const workerScope = globalThis as unknown as WorkerScope;
const runtime = createTabSpeechWorkerRuntime({
  loadModel: () => loadSileroV5Model({ modelUrl, wasmUrl, wasmModuleUrl }),
  postEvent: (event) => workerScope.postMessage(event),
  now: () => performance.now(),
  closeWorker: () => workerScope.close(),
});

workerScope.onmessage = (event) => {
  void runtime.receive(event.data);
};
