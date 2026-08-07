import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ThreeGraphExplorer } from "../features/context/ThreeGraphExplorer";
import type {
  GraphRendererController,
  GraphRendererFactory,
  GraphRendererOptions,
} from "../features/context/threeGraphRenderer";
import {
  demoGraphResponse,
  secondEventId,
} from "./fixtures";

function createRendererHarness() {
  const controller: GraphRendererController = {
    resetCamera: vi.fn(),
    selectNode: vi.fn(),
    setPaused: vi.fn(),
    dispose: vi.fn(),
  };
  let options: GraphRendererOptions | null = null;
  const factory: GraphRendererFactory = vi.fn((nextOptions) => {
    options = nextOptions;
    return controller;
  });
  return {
    controller,
    factory,
    getOptions: () => options,
  };
}

function renderExplorer(rendererFactory: GraphRendererFactory) {
  return render(
    <MemoryRouter>
      <ThreeGraphExplorer
        nodes={demoGraphResponse.nodes}
        edges={demoGraphResponse.edges}
        rendererFactory={rendererFactory}
      />
    </MemoryRouter>,
  );
}

describe("ThreeGraphExplorer", () => {
  it("passes supplied nodes and edges to a real-renderer boundary", () => {
    const harness = createRendererHarness();
    renderExplorer(harness.factory);

    expect(harness.factory).toHaveBeenCalledTimes(1);
    expect(harness.getOptions()?.model.nodes).toHaveLength(3);
    expect(harness.getOptions()?.model.edges).toHaveLength(2);
    expect(
      screen.getByRole("img", { name: /interactive 3d context graph/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Graph node type legend" }),
    ).toHaveTextContent("Event · cube, sized by importance");
  });

  it("supports DOM selection and exposes the event's session timeline", async () => {
    const user = userEvent.setup();
    const harness = createRendererHarness();
    renderExplorer(harness.factory);

    await user.selectOptions(
      screen.getByLabelText("Labeled graph node"),
      `event:${secondEventId}`,
    );

    expect(harness.controller.selectNode).toHaveBeenCalledWith(
      `event:${secondEventId}`,
    );
    expect(screen.getByRole("heading", { name: "Close-range shot saved" })).toBeInTheDocument();
    expect(screen.getByText("Team A vs Team B", { selector: "dd" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open event in session timeline" }),
    ).toHaveAttribute(
      "href",
      `/sessions/11111111-1111-4111-8111-111111111111#event-${secondEventId}`,
    );
  });

  it("accepts renderer selection and resets camera plus DOM detail", async () => {
    const user = userEvent.setup();
    const harness = createRendererHarness();
    renderExplorer(harness.factory);

    harness.getOptions()?.onSelect(`event:${secondEventId}`);
    expect(
      await screen.findByRole("heading", { name: "Close-range shot saved" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset view" }));
    expect(harness.controller.selectNode).toHaveBeenLastCalledWith(null);
    expect(harness.controller.resetCamera).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/choose a labeled node or select a shape/i)).toBeInTheDocument();
  });

  it("honors reduced motion and cannot resume it implicitly", () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const harness = createRendererHarness();
    renderExplorer(harness.factory);

    expect(harness.getOptions()?.reducedMotion).toBe(true);
    expect(harness.controller.setPaused).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Motion reduced" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Reduced motion is active",
    );
  });

  it("disposes the renderer on unmount", () => {
    const harness = createRendererHarness();
    const view = renderExplorer(harness.factory);

    view.unmount();

    expect(harness.controller.dispose).toHaveBeenCalledTimes(1);
  });

  it("falls back to the accessible DOM when WebGL setup fails", () => {
    const factory: GraphRendererFactory = () => {
      throw new Error("WebGL unavailable");
    };
    renderExplorer(factory);

    expect(screen.getByText("3D view unavailable")).toBeInTheDocument();
    expect(screen.getByLabelText("Labeled graph node")).toBeEnabled();
  });

  it("renders a deterministic empty state without starting a renderer", () => {
    const harness = createRendererHarness();
    render(
      <MemoryRouter>
        <ThreeGraphExplorer nodes={[]} edges={[]} rendererFactory={harness.factory} />
      </MemoryRouter>,
    );

    expect(screen.getByText("No graph nodes are available to visualize.")).toBeInTheDocument();
    expect(harness.factory).not.toHaveBeenCalled();
  });
});
