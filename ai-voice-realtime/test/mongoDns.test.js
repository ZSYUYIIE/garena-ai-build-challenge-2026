import assert from "node:assert/strict";
import test from "node:test";

import { parseMongoDnsServers } from "../src/context-builder/mongo.js";

test("parseMongoDnsServers accepts a bounded list of literal IP addresses", () => {
  assert.deepEqual(parseMongoDnsServers(undefined), []);
  assert.deepEqual(
    parseMongoDnsServers(" 1.1.1.1,8.8.8.8,1.1.1.1 "),
    ["1.1.1.1", "8.8.8.8"],
  );
  assert.deepEqual(parseMongoDnsServers("2606:4700:4700::1111"), [
    "2606:4700:4700::1111",
  ]);
});

test("parseMongoDnsServers rejects hostnames and unbounded resolver lists", () => {
  assert.throws(
    () => parseMongoDnsServers("resolver.example.com"),
    /at most three comma-separated IP addresses/u,
  );
  assert.throws(
    () => parseMongoDnsServers("1.1.1.1,8.8.8.8,9.9.9.9,208.67.222.222"),
    /at most three comma-separated IP addresses/u,
  );
});
