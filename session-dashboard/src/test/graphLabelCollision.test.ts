import { describe, expect, it } from "vitest";

import {
  graphCameraHome,
  graphBackgroundColor,
  graphDomainLabelY,
  graphEdgePresentation,
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

  it("positions domain labels above the complete island radius", () => {
    expect(
      graphDomainLabelY({
        position: { x: 4, y: 2, z: 0 },
        radius: 9,
      }),
    ).toBe(12.25);
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

    expect(squareHome.target.y).toBeGreaterThan(0);
    expect(narrowHome.distance).toBeGreaterThan(squareHome.distance);
  });

  it("keeps every default relationship color above 3:1 against the scene", () => {
    const relationshipTypes = [
      "same_session",
      "temporal_relation",
      "shared_entity",
      "shared_topic",
      "semantic_similarity",
    ] as const;

    for (const type of relationshipTypes) {
      const presentation = graphEdgePresentation(type, false);
      expect(
        compositedContrastRatio(
          presentation.color,
          graphBackgroundColor(false),
          presentation.opacity,
        ),
        type,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("uses a near-opaque edge presentation in high contrast mode", () => {
    expect(graphBackgroundColor(true)).toBe(0x000000);
    expect(graphEdgePresentation("same_session", true).opacity).toBeGreaterThanOrEqual(
      0.9,
    );
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
