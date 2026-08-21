import * as ort from "onnxruntime-web/wasm";

export type TensorLike = {
  readonly data: ArrayLike<number | bigint>;
  readonly dims: readonly number[];
  dispose(): void;
};

export type TensorFactory = (
  type: "float32" | "int64",
  data: ArrayLike<number | bigint>,
  dimensions: readonly number[],
) => TensorLike;

export type InferenceSessionLike = {
  run(inputs: Record<string, TensorLike>): Promise<Record<string, TensorLike>>;
  release(): Promise<void>;
};

export type SileroSpeechModel = {
  process(frame: Float32Array): Promise<number>;
  reset(): void;
  close(): Promise<void>;
};

export class SileroV5Model implements SileroSpeechModel {
  private readonly session: InferenceSessionLike;
  private readonly tensorFactory: TensorFactory;
  private state: TensorLike;
  private readonly sampleRate: TensorLike;
  private closed = false;

  constructor(
    session: InferenceSessionLike,
    tensorFactory: TensorFactory,
  ) {
    this.session = session;
    this.tensorFactory = tensorFactory;
    this.state = this.createState();
    this.sampleRate = tensorFactory("int64", new BigInt64Array([16_000n]), [1]);
  }

  async process(frame: Float32Array): Promise<number> {
    if (this.closed) throw new Error("Silero model is closed.");
    if (!(frame instanceof Float32Array) || frame.length !== 512) {
      throw new RangeError("Silero V5 requires exactly 512 samples.");
    }
    const input = this.tensorFactory("float32", frame, [1, 512]);
    const previousState = this.state;
    let outputs: Record<string, TensorLike> | undefined;
    let adoptedState: TensorLike | undefined;
    try {
      outputs = await this.session.run({ input, state: previousState, sr: this.sampleRate });
      const probability = Number(outputs.output?.data[0]);
      const nextState = outputs.stateN;
      if (!Number.isFinite(probability) || probability < 0 || probability > 1 || !nextState) {
        throw new Error("Silero returned an invalid result.");
      }
      if (nextState !== previousState) previousState.dispose();
      this.state = nextState;
      adoptedState = nextState;
      return probability;
    } finally {
      input.dispose();
      for (const tensor of new Set(Object.values(outputs ?? {}))) {
        if (tensor !== adoptedState) tensor.dispose();
      }
    }
  }

  reset(): void {
    if (this.closed) return;
    this.state.dispose();
    this.state = this.createState();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.state.dispose();
    this.sampleRate.dispose();
    await this.session.release();
  }

  private createState(): TensorLike {
    return this.tensorFactory("float32", new Float32Array(2 * 128), [2, 1, 128]);
  }
}

export type SileroV5LoadOptions = {
  modelUrl: string;
  wasmUrl: string;
  wasmModuleUrl: string;
};

export async function loadSileroV5Model(options: SileroV5LoadOptions): Promise<SileroV5Model> {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: options.wasmUrl, mjs: options.wasmModuleUrl };
  const session = await ort.InferenceSession.create(options.modelUrl, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  return new SileroV5Model(
    session as unknown as InferenceSessionLike,
    (type, data, dimensions) => new ort.Tensor(
      type,
      data as never,
      [...dimensions],
    ) as unknown as TensorLike,
  );
}
