import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedExtensionOrigin } from "../src/protocol/websocketPolicy.js";

test("accepts only an exact Chrome extension origin", () => {
  const extensionId = "abcdefghijklmnopabcdefghijklmnop";
  assert.equal(
    isAllowedExtensionOrigin(
      `chrome-extension://${extensionId}`,
      { extensionId },
    ),
    true
  );
  assert.equal(
    isAllowedExtensionOrigin(
      `chrome-extension://${extensionId}/`,
      { extensionId },
    ),
    true
  );
});

test("requires an exact configured ID unless local permissive mode is explicit", () => {
  const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
  assert.equal(isAllowedExtensionOrigin(origin), false);
  assert.equal(
    isAllowedExtensionOrigin(origin, { allowAnyExtensionOrigin: true }),
    true,
  );
});

test("rejects missing and ordinary web origins", () => {
  assert.equal(isAllowedExtensionOrigin(undefined), false);
  assert.equal(isAllowedExtensionOrigin(""), false);
  assert.equal(isAllowedExtensionOrigin("https://example.com"), false);
  assert.equal(isAllowedExtensionOrigin("http://127.0.0.1:8000"), false);
});

test("rejects malformed extension identifiers", () => {
  assert.equal(
    isAllowedExtensionOrigin("chrome-extension://abcdefghijklmnop"),
    false
  );
  assert.equal(
    isAllowedExtensionOrigin(
      "chrome-extension://abcdefghijklmnopabcdefghijklmnoq"
    ),
    false
  );
  assert.equal(
    isAllowedExtensionOrigin(
      "chrome-extension://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP"
    ),
    false
  );
});

test("rejects origin strings containing request components", () => {
  const extensionId = "abcdefghijklmnopabcdefghijklmnop";
  for (const suffix of [
    "/sidepanel.html",
    "/?debug=1",
    "/#fragment",
    ":80",
  ]) {
    assert.equal(
      isAllowedExtensionOrigin(`chrome-extension://${extensionId}${suffix}`),
      false,
      suffix
    );
  }
  assert.equal(
    isAllowedExtensionOrigin(
      `chrome-extension://user:password@${extensionId}`
    ),
    false
  );
});

test("rejects values that are not valid URLs", () => {
  assert.equal(isAllowedExtensionOrigin("chrome-extension://"), false);
  assert.equal(isAllowedExtensionOrigin("not a url"), false);
});

test("optionally pins the allowed extension ID without weakening origin syntax", () => {
  const first = "abcdefghijklmnopabcdefghijklmnop";
  const second = "bcdefghijklmnopabcdefghijklmnopa";
  assert.equal(
    isAllowedExtensionOrigin(`chrome-extension://${first}`, { extensionId: first }),
    true,
  );
  assert.equal(
    isAllowedExtensionOrigin(`chrome-extension://${second}`, { extensionId: first }),
    false,
  );
  assert.equal(
    isAllowedExtensionOrigin(`chrome-extension://${second}`, {
      extensionId: first,
      allowAnyExtensionOrigin: true,
    }),
    true,
  );
});
