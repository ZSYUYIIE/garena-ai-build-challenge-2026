import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { JSDOM } from "jsdom";
import { createElement, type ComponentType, type ReactNode } from "react";
import { createServer } from "vite";

const extensionRoot = fileURLToPath(new URL("../", import.meta.url));

test("shows and changes the controlled Voice narration selection", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://streamsense.test/",
  });
  const restoreGlobals = installDomGlobals(dom.window);
  dom.window.localStorage.setItem(
    "streamsense.voiceNarrationMode.v1",
    "over_audio",
  );
  const vite = await createServer({
    configFile: false,
    root: extensionRoot,
    appType: "custom",
    plugins: [react()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
    },
    server: { middlewareMode: true, ws: false },
  });

  try {
    const [{ fireEvent, render }, configuration, context] = await Promise.all([
      import("@testing-library/react"),
      vite.ssrLoadModule("/src/sidepanel/components/ConfigurationSection.tsx"),
      vite.ssrLoadModule("/src/sidepanel/context/ConfigurationContext.tsx"),
    ]);
    const ConfigurationSection = configuration.ConfigurationSection as ComponentType;
    const ConfigurationOptionsProvider = context.ConfigurationOptionsProvider as ComponentType<{
      children: ReactNode;
    }>;
    const view = render(createElement(
      ConfigurationOptionsProvider,
      null,
      createElement(ConfigurationSection),
    ));
    try {
      const voiceSelect = view.getByRole("button", {
        name: /Voice narration/,
      });

      assert.match(voiceSelect.textContent ?? "", /Narrate over audio/);
      assert.doesNotMatch(voiceSelect.textContent ?? "", /Select an item/);

      const hiddenSelects = view.container.querySelectorAll("select");
      const hiddenVoiceSelect = hiddenSelects.item(1);
      assert.ok(hiddenVoiceSelect);
      fireEvent.change(hiddenVoiceSelect, {
        target: { value: "narration_only" },
      });

      assert.match(voiceSelect.textContent ?? "", /Narration only/);
      assert.equal(
        dom.window.localStorage.getItem("streamsense.voiceNarrationMode.v1"),
        "narration_only",
      );
    } finally {
      view.unmount();
    }
  } finally {
    await vite.close();
    restoreGlobals();
    dom.window.close();
  }
});

function installDomGlobals(window: Window) {
  const globals = globalThis as Record<string, unknown>;
  const values: Record<string, unknown> = {
    window,
    document: window.document,
    navigator: window.navigator,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    Node: window.Node,
    NodeFilter: window.NodeFilter,
    SVGElement: window.SVGElement,
    MutationObserver: window.MutationObserver,
    CSS: window.CSS ?? { escape: (value: string) => value },
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
    cancelAnimationFrame: (timer: number) => clearTimeout(timer),
    PointerEvent: window.PointerEvent ?? window.MouseEvent,
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globals, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  return () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else delete globals[key];
    }
  };
}
