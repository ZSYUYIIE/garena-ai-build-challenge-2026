# StreamSense Hackathon Demo Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finalize the StreamSense hackathon demo with higher-resolution sampling, Gemini Interactions API structured vision, a smaller extension surface, clean dependency/build checks, and a real Chrome-to-Gemini acceptance run.

**Architecture:** Preserve the atomic single-frame pipeline and its one-frame-per-second meaningful-change gate. Move the backend's existing cancellable `fetch` boundary to the stateless Gemini Interactions REST endpoint, while isolating capture sizing in a pure extension helper and deleting extension surfaces that are unreachable from the manifest.

**Tech Stack:** TypeScript 5.9, React 19, Chrome Manifest V3, Vite 8, Tailwind CSS 4, Node.js built-in test runner, JavaScript, Zod, WebSocket, Gemini Interactions API.

## Global Constraints

- Sample at most once per second.
- Maximum sample width is exactly 1280 pixels; preserve aspect ratio and never upscale smaller sources.
- Use a 1280x720 fallback and JPEG quality `0.8`.
- Questions continue using the latest sampled backend frame; do not add on-demand question capture.
- Use raw `fetch` against Gemini Interactions; do not add `@google/genai`.
- Send `store: false` and `Api-Revision: 2026-05-20`.
- Preserve `AbortSignal` cancellation and existing Zod result validation.
- Delete the unused content script, popup, legacy extension-status service/types, runtime-message handlers, `contentSettings`, and `shadcn` dependency.
- Do not expose API keys or signed-in browser data during verification.

---

### Task 1: Higher-resolution frame sampling

**Files:**
- Create: `chrome-extension/src/sidepanel/realtime/frameCapture.ts`
- Create: `chrome-extension/test/frameCapture.test.ts`
- Modify: `chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts`

**Interfaces:**
- Produces: `FRAME_CAPTURE_JPEG_QUALITY: 0.8` and `calculateFrameDimensions(sourceWidth: number, sourceHeight: number): { width: number; height: number }`.
- Consumes: Browser `videoWidth` and `videoHeight`; the existing frame loop consumes the returned dimensions and quality constant.

- [ ] **Step 1: Write failing sizing tests**

Create `chrome-extension/test/frameCapture.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateFrameDimensions,
} from "../src/sidepanel/realtime/frameCapture.ts";

test("caps a 1080p tab at 1280x720", () => {
  assert.deepEqual(calculateFrameDimensions(1920, 1080), {
    width: 1280,
    height: 720,
  });
});

test("does not upscale a smaller source", () => {
  assert.deepEqual(calculateFrameDimensions(800, 600), {
    width: 800,
    height: 600,
  });
});

test("preserves a non-widescreen aspect ratio", () => {
  assert.deepEqual(calculateFrameDimensions(2560, 1600), {
    width: 1280,
    height: 800,
  });
});

test("uses a 1280x720 fallback for unavailable dimensions", () => {
  assert.deepEqual(calculateFrameDimensions(0, 0), {
    width: 1280,
    height: 720,
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd chrome-extension
node --experimental-strip-types --test test/frameCapture.test.ts
```

Expected: FAIL because `frameCapture.ts` does not exist.

- [ ] **Step 3: Implement the sizing boundary**

Create `chrome-extension/src/sidepanel/realtime/frameCapture.ts`:

```ts
const FRAME_CAPTURE_MAX_WIDTH = 1280;
const FALLBACK_SOURCE_WIDTH = 1280;
const FALLBACK_SOURCE_HEIGHT = 720;

export const FRAME_CAPTURE_JPEG_QUALITY = 0.8;

export function calculateFrameDimensions(
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  const safeWidth =
    Number.isFinite(sourceWidth) && sourceWidth > 0
      ? sourceWidth
      : FALLBACK_SOURCE_WIDTH;
  const safeHeight =
    Number.isFinite(sourceHeight) && sourceHeight > 0
      ? sourceHeight
      : FALLBACK_SOURCE_HEIGHT;
  const width = Math.min(FRAME_CAPTURE_MAX_WIDTH, Math.round(safeWidth));
  const height = Math.max(1, Math.round(width * (safeHeight / safeWidth)));

  return { width, height };
}
```

Modify the frame loop in `useRealtimeSession.ts` to import the helper and replace the fixed `640` sizing and `0.72` quality:

```ts
const { width: targetWidth, height: targetHeight } =
  calculateFrameDimensions(video.videoWidth, video.videoHeight);
canvas.width = targetWidth;
canvas.height = targetHeight;
```

Pass `FRAME_CAPTURE_JPEG_QUALITY` as the final `canvas.toBlob` argument. Keep `VIDEO_FRAME_INTERVAL_MS = 1_000` unchanged.

- [ ] **Step 4: Run focused and extension tests and verify GREEN**

Run:

```bash
cd chrome-extension
node --experimental-strip-types --test test/frameCapture.test.ts
npm test
```

Expected: all focused tests and the full extension test suite pass.

- [ ] **Step 5: Commit the frame-sampling change**

```bash
git add chrome-extension/src/sidepanel/realtime/frameCapture.ts chrome-extension/src/sidepanel/realtime/useRealtimeSession.ts chrome-extension/test/frameCapture.test.ts
git commit -m "feat: sample clearer tab frames"
```

---

### Task 2: Gemini Interactions structured vision

**Files:**
- Modify: `ai-voice-realtime/test/vision.test.js`
- Modify: `ai-voice-realtime/src/gemini/vision.js`

**Interfaces:**
- Consumes: Existing `analyzeVisionFrame` and `answerVisionQuestion` arguments, including `{ mimeType, data }` frame objects and `AbortSignal`.
- Produces: The same validated application results through a new Interactions REST wire contract.

- [ ] **Step 1: Replace the legacy request test with a failing Interactions contract test**

Update the existing request test in `ai-voice-realtime/test/vision.test.js` to capture the URL, headers, body, and signal, and return a complete Interactions response fixture:

```js
test("analyzeVisionFrame uses the Gemini Interactions contract", async (t) => {
  let requestUrl;
  let requestBody;
  let requestHeaders;
  let requestSignal;
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, init) => {
    requestUrl = url;
    requestBody = JSON.parse(init.body);
    requestHeaders = new Headers(init.headers);
    requestSignal = init.signal;
    return new Response(
      JSON.stringify({
        id: "interaction-test",
        model: "gemini-3.6-flash",
        status: "completed",
        steps: [
          {
            type: "user_input",
            content: [{ type: "text", text: "request fixture" }],
          },
          {
            type: "model_output",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  shouldNarrate: false,
                  description: "",
                  event: null,
                }),
              },
            ],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const controller = new AbortController();
  await analyzeVisionFrame({
    apiKey: "test-key",
    model: "gemini-3.6-flash",
    frame: { mimeType: "image/jpeg", data: "test-frame" },
    initial: true,
    narrationLevel: "standard",
    previousDescription: "",
    timestampSeconds: 0,
    signal: controller.signal,
  });

  assert.equal(
    requestUrl,
    "https://generativelanguage.googleapis.com/v1beta/interactions",
  );
  assert.equal(requestHeaders.get("x-goog-api-key"), "test-key");
  assert.equal(requestHeaders.get("api-revision"), "2026-05-20");
  assert.deepEqual(requestBody.input.slice(1), [
    { type: "image", data: "test-frame", mime_type: "image/jpeg" },
  ]);
  assert.equal(requestBody.response_format.type, "text");
  assert.equal(requestBody.response_format.mime_type, "application/json");
  assert.equal(requestBody.response_format.schema.type, "object");
  assert.deepEqual(requestBody.generation_config, {
    max_output_tokens: 512,
    thinking_level: "minimal",
  });
  assert.equal(requestBody.store, false);
  assert.equal(requestSignal, controller.signal);
});
```

- [ ] **Step 2: Run the focused backend test and verify RED**

Run:

```bash
cd ai-voice-realtime
node --test test/vision.test.js
```

Expected: FAIL because the existing code expects `candidates`, uses `generateContent`, and emits camel-case generation configuration.

- [ ] **Step 3: Implement the Interactions request and output extraction**

In `vision.js`, convert the response schemas to standard lower-case JSON Schema types. Represent nullable events with `anyOf`:

```js
event: {
  anyOf: [
    {
      type: "object",
      properties: eventProperties,
      required: [
        "eventType",
        "entities",
        "description",
        "importance",
        "confidence",
      ],
    },
    { type: "null" },
  ],
},
```

Replace the REST request with:

```js
const response = await fetch(
  "https://generativelanguage.googleapis.com/v1beta/interactions",
  {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
      "Api-Revision": "2026-05-20",
    },
    body: JSON.stringify({
      model,
      input: [
        { type: "text", text: prompt },
        { type: "image", data: frame.data, mime_type: frame.mimeType },
      ],
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: responseSchema,
      },
      generation_config: {
        max_output_tokens: 512,
        thinking_level: "minimal",
      },
      store: false,
    }),
  },
);
```

Extract only model output text:

```js
const text = (payload.steps || [])
  .filter((step) => step.type === "model_output")
  .flatMap((step) => step.content || [])
  .filter((content) => content.type === "text")
  .map((content) => content.text || "")
  .join("")
  .trim();
```

Keep the existing non-2xx error branch, empty-result error, `JSON.parse`, and Zod parsing.

- [ ] **Step 4: Run focused and backend tests and verify GREEN**

Run:

```bash
cd ai-voice-realtime
node --test test/vision.test.js
npm test
npm run check
```

Expected: the Interactions contract test and all backend checks pass.

- [ ] **Step 5: Commit the API migration**

```bash
git add ai-voice-realtime/src/gemini/vision.js ai-voice-realtime/test/vision.test.js
git commit -m "feat: migrate vision to Gemini Interactions"
```

---

### Task 3: Remove unused extension surfaces and warnings

**Files:**
- Create: `chrome-extension/extensionManifest.ts`
- Create: `chrome-extension/test/manifest.test.ts`
- Modify: `chrome-extension/manifest.config.ts`
- Modify: `chrome-extension/vite.config.ts`
- Modify: `chrome-extension/src/services/background.ts`
- Modify: `chrome-extension/src/sidepanel/index.css`
- Modify: `chrome-extension/package.json`
- Modify: `chrome-extension/package-lock.json`
- Delete: `chrome-extension/src/content/main.ts`
- Delete: `chrome-extension/src/popup/index.html`
- Delete: `chrome-extension/src/popup/main.ts`
- Delete: `chrome-extension/src/popup/style.css`
- Delete: `chrome-extension/src/services/extensionStatus.ts`
- Delete: `chrome-extension/src/types.ts`

**Interfaces:**
- Consumes: Existing capture-target authorization and `chrome.tabCapture.onStatusChanged` badge synchronization.
- Produces: A manifest without a global content script or `contentSettings`, and an extension build with only reachable entry points.

- [ ] **Step 1: Write a failing manifest behavior test**

Create `chrome-extension/test/manifest.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { createExtensionManifest } from "../extensionManifest.ts";

test("ships only the permissions and entry points used by the side-panel demo", () => {
  const manifest = createExtensionManifest({
    name: "StreamSense test",
    version: "1.2.3",
  });

  assert.equal(manifest.name, "StreamSense test");
  assert.equal(manifest.version, "1.2.3");
  assert.equal("content_scripts" in manifest, false);
  assert.deepEqual(manifest.permissions, [
    "activeTab",
    "sidePanel",
    "storage",
    "tabCapture",
  ]);
});
```

- [ ] **Step 2: Run the manifest test and verify RED**

Run:

```bash
cd chrome-extension
node --experimental-strip-types --test test/manifest.test.ts
```

Expected: FAIL because `extensionManifest.ts` does not exist.

- [ ] **Step 3: Remove dead extension paths and simplify the manifest/background**

Create `extensionManifest.ts` as the testable static manifest boundary:

```ts
import type { ManifestV3Export } from "@crxjs/vite-plugin";

type StaticManifest = Exclude<Awaited<ManifestV3Export>, Function>;

type PackageMetadata = {
  name: string;
  version: string;
};

export function createExtensionManifest(
  pkg: PackageMetadata,
): StaticManifest {
  return {
    manifest_version: 3,
    name: pkg.name,
    version: pkg.version,
    icons: { 48: "public/logo.png" },
    action: {
      default_icon: { 48: "public/logo.png" },
    },
    background: {
      service_worker: "src/services/background.ts",
    },
    side_panel: {
      default_path: "src/sidepanel/index.html",
    },
    permissions: ["activeTab", "sidePanel", "storage", "tabCapture"],
    host_permissions: [
      "http://127.0.0.1:8000/*",
      "http://localhost:8000/*",
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; connect-src ws://127.0.0.1:8000 ws://localhost:8000;",
    },
  };
}
```

Change `manifest.config.ts` to call `defineManifest(createExtensionManifest(pkg))`. This removes `content_scripts` and `contentSettings` from the built manifest. Delete the six unused content/popup/status files listed above with an explicit patch.

Reduce `background.ts` to the three live responsibilities:

```ts
import {
  authorizeCaptureTarget,
  saveCaptureTarget,
} from "./captureTarget";
import { syncCaptureBadge } from "./captureBadge";

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

chrome.action.onClicked.addListener((tab) => {
  void authorizeCaptureTarget(tab, {
    persistTarget: saveCaptureTarget,
    openPanel: (tabId) => chrome.sidePanel.open({ tabId }),
  }).catch((error) => {
    console.error("Could not authorize StreamSense capture:", error);
  });
});

chrome.tabCapture.onStatusChanged.addListener((info) => {
  void syncCaptureBadge(info, (details) =>
    chrome.action.setBadgeText(details),
  ).catch((error) => {
    console.error("Could not update the StreamSense capture badge:", error);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeText({ text: "OFF" });
});
```

- [ ] **Step 4: Remove the vulnerable unused dependency**

Delete `@import "shadcn/tailwind.css";` from `src/sidepanel/index.css`, then run:

```bash
cd chrome-extension
npm uninstall shadcn
```

Expected: `shadcn` and its transitive CLI/server dependency graph disappear from `package.json`, `package-lock.json`, and `node_modules`.

- [ ] **Step 5: Make Vite configuration ESM-native**

In both config files, change JSON imports to:

```ts
import pkg from "./package.json" with { type: "json" };
```

In `vite.config.ts`, replace `node:path` and `__dirname` with:

```ts
import { fileURLToPath } from "node:url";

const sourceDirectory = fileURLToPath(new URL("./src", import.meta.url));
```

Use `sourceDirectory` as the `@` alias, and use `pkg.name` and `pkg.version` for the zip filename.

- [ ] **Step 6: Run cleanup verification and verify GREEN**

Run:

```bash
cd chrome-extension
node --experimental-strip-types --test test/manifest.test.ts
npm test
npm run build
npm audit --omit=dev
```

Expected: tests and build pass, no identified native Vite config warnings are printed, and the production audit reports zero vulnerabilities.

Also run from the repository root:

```bash
rg -n "ExtensionStatus|MessageAction|contentSettings|src/content/main|src/popup|shadcn/tailwind" chrome-extension --glob '!node_modules/**' --glob '!dist/**'
```

Expected: no matches.

- [ ] **Step 7: Commit the cleanup**

```bash
git add chrome-extension
git commit -m "chore: remove unused extension surfaces"
```

---

### Task 4: Full and live demo verification

**Files:**
- Modify only if verification exposes a reproducible regression; any such fix must begin with a failing focused test.

**Interfaces:**
- Consumes: Built extension in `chrome-extension/dist`, backend `npm start`, configured Gemini credentials, and an ordinary HTTPS Chrome tab.
- Produces: Fresh automated and manual acceptance evidence.

- [ ] **Step 1: Run all automated release checks from clean commands**

```bash
cd ai-voice-realtime
npm test
npm run check
npm audit --omit=dev

cd ../chrome-extension
npm test
npm run build
npm audit --omit=dev
```

Expected: every command exits zero, all tests pass, both production audits report zero vulnerabilities, and the extension build omits the identified config warnings.

- [ ] **Step 2: Start the stable backend without printing secrets**

Run `npm start` from `ai-voice-realtime` in a persistent terminal session. Confirm the server listens on its documented loopback port and does not log environment secret values.

- [ ] **Step 3: Rebuild/reload and exercise the real Chrome flow**

Using the installed unpacked extension and an ordinary HTTPS tab:

1. Reload `chrome-extension/dist` from `chrome://extensions` if Chrome has not picked up the new build.
2. Click the StreamSense toolbar icon on the target tab.
3. Start StreamSense from the side panel.
4. Confirm the badge becomes `ON` and grounded narration appears.
5. Ask a question whose answer is visible in the sampled tab.
6. Confirm a grounded Gemini answer appears.
7. Stop StreamSense and confirm the badge becomes `OFF` and the session closes cleanly.

- [ ] **Step 4: Inspect backend output and working tree**

Confirm the live run has no unhandled rejection, API contract error, or leaked credential. Then run:

```bash
git status --short
git diff --check
```

Expected: no unintended generated or unrelated changes and no whitespace errors.

- [ ] **Step 5: If verification required a fix, repeat the full gate and commit it**

For each discovered regression, add a focused failing test, watch it fail for that regression, make the minimal production change, rerun the focused test, then rerun Step 1. Commit only after the fresh full gate succeeds.
