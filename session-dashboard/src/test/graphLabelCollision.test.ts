import { describe, expect, it } from "vitest";

import {
  graphCameraHome,
  graphCameraPose,
  graphAxisFrame,
  graphBackgroundColor,
  graphDomainLabelY,
  graphDomainCoreRadius,
  graphEdgePresentation,
  graphHierarchyGuides,
  graphNodeDisplayLabel,
  resolveGraphRenderSize,
  selectNonOverlappingGraphLabelIds,
  shouldDimGraphNode,
  type GraphLabelCollisionCandidate,
} from "../features/context/threeGraphRenderer";
import { buildGraphSceneModel } from "../features/context/graphModel";

function candidate(
  id: string,
  priority: number,
  left: number,
  top: number,
  width = 100,
  height = 24,
): GraphLabelCollisionCandidate {
  return {
    id,
    priority,
    bounds: {
      left,
      right: left + width,
      top,
      bottom: top + height,
    },
  };
}

describe("graph label collision selection", () => {
  it("keeps a selected label instead of an overlapping default label", () => {
    const visible = selectNonOverlappingGraphLabelIds([
      candidate("default-event", 650, 0, 0),
      candidate("selected-node", 1_000, 40, 4),
    ]);

    expect([...visible]).toEqual(["selected-node"]);
  });

  it("keeps non-overlapping hierarchy labels", () => {
    const visible = selectNonOverlappingGraphLabelIds([
      candidate("domain:sports", 850, 0, 0),
      candidate("session:match", 800, 120, 0),
      candidate("event:goal", 650, 240, 0),
    ]);

    expect([...visible]).toEqual([
      "domain:sports",
      "session:match",
      "event:goal",
    ]);
  });

  it("breaks equal-priority collisions deterministically by id", () => {
    const visible = selectNonOverlappingGraphLabelIds([
      candidate("node:z", 650, 0, 0),
      candidate("node:a", 650, 0, 0),
    ]);

    expect([...visible]).toEqual(["node:a"]);
  });

  it("reserves a readable gap between neighboring labels", () => {
    const candidates = [
      candidate("left", 800, 0, 0),
      candidate("right", 700, 103, 0),
    ];

    expect([...selectNonOverlappingGraphLabelIds(candidates, 6)]).toEqual([
      "left",
    ]);
    expect([...selectNonOverlappingGraphLabelIds(candidates, 2)]).toEqual([
      "left",
      "right",
    ]);
  });
});

describe("graph renderer accessibility presentation", () => {
  it("does not inflate a narrow reflow viewport", () => {
    expect(resolveGraphRenderSize(288.8, 480.4)).toEqual({
      width: 288,
      height: 480,
    });
  });

  it("positions domain labels directly above the dominant root sphere", () => {
    expect(
      graphDomainLabelY({
        position: { x: 4, y: 2, z: 0 },
        radius: 9,
      }),
    ).toBeCloseTo(12.05);
  });

  it("derives one non-semantic root-to-session hierarchy guide per session", () => {
    const model = buildGraphSceneModel(
      [
        {
          id: "session:guide:a",
          type: "session",
          label: "First sports session",
          metadata: { domain: "sports" },
        },
        {
          id: "session:guide:b",
          type: "session",
          label: "Second sports session",
          metadata: { domain: "sports" },
        },
      ],
      [],
    );
    const guides = graphHierarchyGuides(model);

    expect(guides).toHaveLength(3);
    expect(guides.filter((guide) => guide.kind === "domain-session").map((guide) => guide.sessionNodeId)).toEqual([
      "session:guide:a",
      "session:guide:b",
    ]);
    expect(guides.find((guide) => guide.kind === "memory-domain")?.source).toBe(
      model.memoryRoot.position,
    );
    expect(model.edges).toHaveLength(0);
    expect(graphDomainCoreRadius(model.domains[0]!)).toBeGreaterThan(
      Math.max(...model.nodes.map((node) => node.radius)),
    );
  });

  it("provides deterministic semantic projection camera poses", () => {
    const model = buildGraphSceneModel(
      [
        {
          id: "session:axes",
          type: "session",
          label: "Axes sports session",
          metadata: { domain: "sports" },
        },
      ],
      [],
    );
    const importanceEntertainment = graphCameraPose(model, 1, "importance-entertainment");
    const progressEntertainment = graphCameraPose(model, 1, "progress-entertainment");
    const progressImportance = graphCameraPose(model, 1, "progress-importance");
    const overview = graphCameraPose(model, 1, "overview");

    expect(importanceEntertainment.position.x).toBeGreaterThan(importanceEntertainment.target.x);
    expect(importanceEntertainment.position.y).toBeCloseTo(importanceEntertainment.target.y);
    expect(importanceEntertainment.position.z).toBeCloseTo(importanceEntertainment.target.z);
    expect(progressEntertainment.position.y).toBeGreaterThan(progressEntertainment.target.y);
    expect(progressImportance.position.z).toBeGreaterThan(progressImportance.target.z);
    expect(overview.position.x).toBeGreaterThan(overview.target.x);
    expect(overview.position.y).toBeGreaterThan(overview.target.y);
    expect(overview.position.z).toBeGreaterThan(overview.target.z);
    expect(importanceEntertainment.distance).toBeGreaterThan(0);
    expect(progressEntertainment.distance).toBeGreaterThan(0);
    expect(progressImportance.distance).toBeGreaterThan(0);
    expect(graphAxisFrame(model).xMaximum).toBeGreaterThan(
      graphAxisFrame(model).xMinimum,
    );
  });

  it("replaces an uninformative live session canvas label with honest metadata", () => {
    const model = buildGraphSceneModel(
      [
        {
          id: "session:generic",
          type: "session",
          label: "StreamSense session",
          metadata: {
            domain: "football",
            startedAt: "2026-08-08T10:00:00.000Z",
          },
        },
      ],
      [],
    );

    expect(graphNodeDisplayLabel(model.nodes[0]!)).toMatch(/^Sports · /);
    expect(graphNodeDisplayLabel(model.nodes[0]!)).not.toBe("StreamSense session");
  });

  it("frames sphere radii and domain labels more conservatively on narrow screens", () => {
    const model = buildGraphSceneModel(
      [
        {
          id: "session:camera",
          type: "session",
          label: "Sparse sports session",
          metadata: { domain: "sports" },
        },
      ],
      [],
    );
    const squareHome = graphCameraHome(model, 1);
    const narrowHome = graphCameraHome(model, 0.4);

    expect(Number.isFinite(squareHome.target.y)).toBe(true);
    expect(narrowHome.distance).toBeGreaterThan(squareHome.distance);
    expect(squareHome.position.x).toBeCloseTo(squareHome.target.x);
    expect(squareHome.position.y).toBeCloseTo(squareHome.target.y);
    expect(squareHome.position.z).toBeGreaterThan(squareHome.target.z);
  });

  it("keeps every persistent relationship color above 3:1 against the scene", () => {
    const relationshipTypes = [
      "same_session",
      "temporal_relation",
    ] as const;

    for (const type of relationshipTypes) {
      const presentation = graphEdgePresentation(type);
      expect(
        compositedContrastRatio(
          presentation.color,
          graphBackgroundColor(),
          presentation.opacity,
        ),
        type,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("uses one stable graph presentation instead of a theme mode", () => {
    expect(graphBackgroundColor()).toBe(0x07111f);
    expect(graphEdgePresentation("same_session").opacity).toBe(0.6);
    expect(graphEdgePresentation("shared_topic").opacity).toBe(0);
  });

  it("keeps a hovered node visible while another selected branch has focus", () => {
    expect(
      shouldDimGraphNode({
        focusNodeId: "selected",
        nodeId: "hovered",
        connected: false,
        hovered: true,
      }),
    ).toBe(false);
    expect(
      shouldDimGraphNode({
        focusNodeId: "selected",
        nodeId: "unrelated",
        connected: false,
        hovered: false,
      }),
    ).toBe(true);
  });
});

function compositedContrastRatio(
  foreground: number,
  background: number,
  opacity: number,
): number {
  const foregroundChannels = colorChannels(foreground);
  const backgroundChannels = colorChannels(background);
  const composited = foregroundChannels.map((channel, index) =>
    Math.round(
      channel * opacity + backgroundChannels[index]! * (1 - opacity),
    ),
  );
  const foregroundLuminance = relativeLuminance(composited);
  const backgroundLuminance = relativeLuminance(backgroundChannels);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function colorChannels(color: number): number[] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function relativeLuminance(channels: number[]): number {
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}
