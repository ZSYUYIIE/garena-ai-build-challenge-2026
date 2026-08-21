import assert from "node:assert/strict";
import test from "node:test";

import { SileroV5Model } from "../src/sidepanel/realtime/sileroV5.ts";

class FakeTensor {
  disposeCalls = 0;
  readonly data: ArrayLike<number | bigint>;
  readonly dims: readonly number[];
  constructor(data: ArrayLike<number | bigint>, dims: readonly number[]) {
    this.data = data;
    this.dims = dims;
  }
  dispose() { this.disposeCalls += 1; }
}

function fixture(probability = 0.82) {
  const created: FakeTensor[] = [];
  const output = new FakeTensor(new Float32Array([probability]), [1, 1]);
  const nextState = new FakeTensor(new Float32Array(256), [2, 1, 128]);
  const tensorFactory = (_type: "float32" | "int64", data: ArrayLike<number | bigint>, dims: readonly number[]) => {
    const tensor = new FakeTensor(data, dims);
    created.push(tensor);
    return tensor;
  };
  const session = {
    runCalls: 0,
    releaseCalls: 0,
    inputs: null as Record<string, FakeTensor> | null,
    async run(inputs: Record<string, FakeTensor>) {
      this.runCalls += 1;
      this.inputs = inputs;
      return { output, stateN: nextState };
    },
    async release() { this.releaseCalls += 1; },
  };
  return { created, nextState, output, session, tensorFactory };
}

test("runs the Silero V5 tensor contract and owns the replacement state", async () => {
  const f = fixture();
  const model = new SileroV5Model(f.session, f.tensorFactory);
  assert.ok(Math.abs(await model.process(new Float32Array(512)) - 0.82) < 0.000_001);
  assert.deepEqual(f.session.inputs!.input.dims, [1, 512]);
  assert.deepEqual(f.session.inputs!.state.dims, [2, 1, 128]);
  assert.deepEqual(Array.from(f.session.inputs!.sr.data), [16_000n]);
  assert.equal(f.session.inputs!.input.disposeCalls, 1);
  assert.equal(f.session.inputs!.state.disposeCalls, 1);
  assert.equal(f.output.disposeCalls, 1);
  assert.equal(f.nextState.disposeCalls, 0);
});

test("rejects wrong frame sizes before inference", async () => {
  const f = fixture();
  const model = new SileroV5Model(f.session, f.tensorFactory);
  await assert.rejects(model.process(new Float32Array(640)), /512/);
  assert.equal(f.session.runCalls, 0);
});

test("disposes transient input when inference throws", async () => {
  const f = fixture();
  f.session.run = async (inputs: Record<string, FakeTensor>) => {
    f.session.inputs = inputs;
    throw new Error("provider details");
  };
  const model = new SileroV5Model(f.session, f.tensorFactory);
  await assert.rejects(model.process(new Float32Array(512)), /provider details/);
  assert.equal(f.session.inputs!.input.disposeCalls, 1);
  assert.equal(f.session.inputs!.state.disposeCalls, 0);
});

test("closes session and retained tensors exactly once", async () => {
  const f = fixture();
  const model = new SileroV5Model(f.session, f.tensorFactory);
  await model.close();
  await model.close();
  assert.equal(f.session.releaseCalls, 1);
  assert.equal(f.created[0].disposeCalls, 1);
  assert.equal(f.created[1].disposeCalls, 1);
});
