import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ThreeGraphExplorer } from "../features/context/ThreeGraphExplorer";
import type { GraphSceneScope } from "../features/context/graphModel";
import type {
  GraphRendererController,
  GraphRendererFactory,
  GraphRendererOptions,
} from "../features/context/threeGraphRenderer";
import { demoGraphResponse, secondEventId } from "./fixtures";

function createRendererHarness() {
  const controller: GraphRendererController = {
    resetCamera: vi.fn(),
    setCameraView: vi.fn(),
    zoomCamera: vi.fn(),
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

function renderExplorer(
  rendererFactory: GraphRendererFactory,
  nodes = demoGraphResponse.nodes,
  edges = demoGraphResponse.edges,
  scope: GraphSceneScope = "filtered",
) {
  return render(
    <MemoryRouter>
      <ThreeGraphExplorer
        nodes={nodes}
        edges={edges}
        scope={scope}
        rendererFactory={rendererFactory}
      />
    </MemoryRouter>,
  );
}

describe("ThreeGraphExplorer", () => {
  it("explains semantic axes and an adaptive single-lane 2D view", () => {
    const harness = createRendererHarness();
    renderExplorer(harness.factory);

    expect(harness.factory).toHaveBeenCalledTimes(1);
    expect(harness.getOptions()?.model.nodes).toHaveLength(3);
    expect(harness.getOptions()?.model.edges).toHaveLength(2);
    expect(
      screen.getByRole("img", {
        name: /interactive 2d streamsense memory map of progress and importance/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 session · 1 moment · 1 populated lane of 1")).toBeInTheDocument();
    expect(
      screen.getByText(/single-lane view uses an honest two-dimensional plot/i, {
        selector: "#graph-layout-explanation",
      }),
    ).toHaveClass("visually-hidden");
    expect(document.querySelector(".graph-layout-explanation")).toBeNull();
    const hierarchy = screen.getByRole("list", {
      name: "Relationship map hierarchy",
    });
    expect(hierarchy).toHaveTextContent("Memory");
    expect(hierarchy).toHaveTextContent("Domains");
    expect(hierarchy).toHaveTextContent("Sessions");
    expect(
      hierarchy,
    ).toHaveTextContent("Moments and context");
    expect(hierarchy).not.toHaveTextContent("largest sphere represents");
    expect(
      screen.getByRole("list", { name: "Graph node role legend" }),
    ).toHaveTextContent("StreamSense Memory · largest root sphere");
    expect(
      screen.getByRole("list", { name: "Graph node role legend" }),
    ).toHaveTextContent("Event · filled sphere sized by importance");
    expect(
      screen.getByRole("list", { name: "Graph relationship legend" }),
    ).toHaveTextContent("Belongs to the same session");
    expect(
      screen.getByText(/events alone use exact progress and importance coordinates/i),
    ).toBeInTheDocument();
    const viewport = screen.getByRole("img").closest(".graph-visual-layout");
    const details = screen
      .getByRole("heading", { name: "Inspect a node" })
      .closest("section");
    expect(viewport).not.toBeNull();
    expect(details).toHaveClass("graph-accessible-details");
    expect(
      viewport!.compareDocumentPosition(details!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.querySelector("aside.graph-details")).toBeNull();
  });

  it("supports DOM selection, describes first-hop edges, and exposes the timeline", async () => {
    const user = userEvent.setup();
    const harness = createRendererHarness();
    const view = renderExplorer(harness.factory);

    await user.click(screen.getByLabelText("Labeled graph node"));
    const eventOption = await screen.findByRole("option", {
      name: /event: close-range shot saved/i,
    });
    expect(eventOption.closest('[data-slot="select-content"]')).toHaveClass(
      "graph-node-select-content",
    );
    await user.click(eventOption);

    expect(harness.controller.selectNode).toHaveBeenCalledWith(
      `event:${secondEventId}`,
    );
    expect(
      screen.getByRole("heading", { name: "Close-range shot saved" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Team A vs Team B", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText(/belongs to the session “Team A vs Team B”/i)).toBeInTheDocument();
    expect(screen.getByText(/tagged with the topic “Defensive save”/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open event in session timeline" }),
    ).toHaveAttribute(
      "href",
      `/sessions/11111111-1111-4111-8111-111111111111#event-${secondEventId}`,
    );
    expect(view.container.querySelector(".graph-selection")).not.toHaveAttribute(
      "aria-live",
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("forces a five-lane 3D overview without inventing sessions or moments", () => {
    const harness = createRendererHarness();
    renderExplorer(
      harness.factory,
      demoGraphResponse.nodes,
      demoGraphResponse.edges,
      "all-domains-overview",
    );

    const model = harness.getOptions()?.model;
    expect(model?.projectionMode).toBe("three-dimensional");
    expect(model?.domains).toHaveLength(5);
    expect(model?.nodes).toHaveLength(demoGraphResponse.nodes.length);
    expect(model?.edges).toHaveLength(demoGraphResponse.edges.length);
    expect(screen.getByText("1 session · 1 moment · 1 populated lane of 5")).toBeInTheDocument();
    expect(screen.getAllByText(/No saved sessions/)).toHaveLength(4);
    expect(screen.getByRole("button", { name: "3D overview" })).toBeInTheDocument();
    expect(
      screen.getByText(/reserves the five StreamSense entertainment lanes/i),
    ).toHaveClass("visually-hidden");
  });

  it("keeps an unavailable-domain session readable in a two-dimensional view", () => {
    const harness = createRendererHarness();
    const sessionId = "77777777-7777-4777-8777-777777777777";
    renderExplorer(
      harness.factory,
      [
        {
          id: "session:unknown",
          type: "session",
          label: "StreamSense session",
          sessionId,
          metadata: { domain: "unknown", durationSeconds: 30 },
        },
        {
          id: "event:unknown",
          type: "event",
          label: "A bear climbs a snowy slope",
          sessionId,
          eventId: "unknown-event",
          metadata: { timestampSeconds: 10 },
        },
      ],
      [
        {
          id: "edge:unknown",
          source: "session:unknown",
          target: "event:unknown",
          type: "same_session",
          weight: 1,
        },
      ],
    );

    expect(harness.getOptions()?.model.projectionMode).toBe("two-dimensional");
    expect(harness.getOptions()?.model.nodes).toHaveLength(2);
    expect(harness.getOptions()?.model.edges).toHaveLength(1);
    expect(screen.getByText(/Domain unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/other entertainment/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^unknown$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^unclassified$/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Labeled graph node")).toBeEnabled();
  });

  it("provides semantic camera projections for a multi-domain graph", async () => {
    const user = userEvent.setup();
    const harness = createRendererHarness();
    renderExplorer(harness.factory, [
      ...demoGraphResponse.nodes,
      {
        id: "session:esports",
        type: "session",
        label: "Esports final",
        sessionId: "22222222-2222-4222-8222-222222222222",
        metadata: { domain: "esports", durationSeconds: 100 },
      },
    ]);

    await user.click(screen.getByRole("button", { name: "3D overview" }));
    await user.click(screen.getByRole("button", { name: "Progress × importance" }));
    await user.click(screen.getByRole("button", { name: "Progress × entertainment" }));
    await user.click(screen.getByRole("button", { name: "Importance × entertainment" }));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Reset view" }));

    expect(harness.controller.setCameraView).toHaveBeenNthCalledWith(1, "overview");
    expect(harness.controller.setCameraView).toHaveBeenNthCalledWith(2, "progress-importance");
    expect(harness.controller.setCameraView).toHaveBeenNthCalledWith(3, "progress-entertainment");
    expect(harness.controller.setCameraView).toHaveBeenNthCalledWith(4, "importance-entertainment");
    expect(harness.controller.zoomCamera).toHaveBeenNthCalledWith(1, 0.82);
    expect(harness.controller.zoomCamera).toHaveBeenNthCalledWith(2, 1.22);
    expect(harness.controller.resetCamera).toHaveBeenCalledTimes(1);
  });

  it("does not offer 3D-only controls for a single entertainment lane", () => {
    const harness = createRendererHarness();
    renderExplorer(harness.factory);

    expect(screen.queryByRole("button", { name: "3D overview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Progress × entertainment" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Progress × importance" })).toBeInTheDocument();
    expect(harness.getOptions()?.model.projectionMode).toBe("two-dimensional");
  });

  it("accepts renderer selection and provides an explicit clear action", async () => {
    const user = userEvent.setup();
    const harness = createRendererHarness();
    renderExplorer(harness.factory);

    harness.getOptions()?.onSelect(`event:${secondEventId}`);
    expect(
      await screen.findByRole("heading", { name: "Close-range shot saved" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(harness.controller.selectNode).toHaveBeenLastCalledWith(null);
    expect(screen.getByText(/choose a labeled node or select a sphere/i)).toBeInTheDocument();
  });

  it("honors reduced motion and disables camera easing", () => {
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
    expect(screen.getByRole("status")).toHaveTextContent(
      "Reduced motion is active. Camera easing is disabled.",
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

    expect(screen.getByText("Visual map unavailable")).toBeInTheDocument();
    expect(screen.getByLabelText("Labeled graph node")).toBeEnabled();
    expect(screen.getByText(/complete readable relationship lists/i)).toBeInTheDocument();
  });

  it("renders a deterministic empty state without starting a renderer", () => {
    const harness = createRendererHarness();
    render(
      <MemoryRouter>
        <ThreeGraphExplorer
          nodes={[]}
          edges={[]}
          rendererFactory={harness.factory}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("No graph nodes are available to visualize."),
    ).toBeInTheDocument();
    expect(harness.factory).not.toHaveBeenCalled();
  });
});
