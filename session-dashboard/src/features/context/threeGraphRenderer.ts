import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/addons/renderers/CSS2DRenderer.js";

import { formatDateTime } from "../../lib/format";
import type {
  GraphDomainCluster,
  GraphSceneModel,
  PositionedGraphEdge,
  PositionedGraphNode,
} from "./graphModel";

export type GraphCameraView =
  | "overview"
  | "progress-importance"
  | "progress-entertainment"
  | "importance-entertainment";

export type GraphRendererController = {
  resetCamera: () => void;
  setCameraView: (view: GraphCameraView) => void;
  zoomCamera: (factor: number) => void;
  selectNode: (nodeId: string | null) => void;
  setPaused: (paused: boolean) => void;
  dispose: () => void;
};

export type GraphRendererOptions = {
  container: HTMLDivElement;
  canvas: HTMLCanvasElement;
  model: GraphSceneModel;
  reducedMotion: boolean;
  onSelect: (nodeId: string) => void;
  onHover: (nodeId: string | null) => void;
};

export type GraphRendererFactory = (
  options: GraphRendererOptions,
) => GraphRendererController;

export type GraphLabelCollisionCandidate = {
  id: string;
  priority: number;
  bounds: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
};

export type GraphHierarchyGuide = {
  id: string;
  kind: "memory-domain" | "domain-session";
  domainKey: string;
  sessionNodeId: string | null;
  source: GraphDomainCluster["position"];
  target: PositionedGraphNode["position"];
};

export type GraphAxisFrame = {
  origin: GraphDomainCluster["position"];
  xMinimum: number;
  xMaximum: number;
  yMinimum: number;
  yMaximum: number;
  zMinimum: number;
  zMaximum: number;
};

const DEFAULT_GRAPH_BACKGROUND = 0x07111f;

export function graphBackgroundColor(): number {
  return DEFAULT_GRAPH_BACKGROUND;
}

export function graphEdgePresentation(
  type: PositionedGraphEdge["type"],
): { color: number; opacity: number } {
  return {
    color: edgeColor(type),
    // Context links are disclosed on focus so the overview stays readable.
    // Persistent hierarchy and chronology remain above 3:1 against the scene.
    opacity:
      type === "same_session" || type === "temporal_relation" ? 0.6 : 0,
  };
}

export function resolveGraphRenderSize(
  measuredWidth: number,
  measuredHeight: number,
  fallbackWidth = 720,
  fallbackHeight = 500,
): { width: number; height: number } {
  const width = measuredWidth > 0 ? measuredWidth : fallbackWidth;
  const height = measuredHeight > 0 ? measuredHeight : fallbackHeight;
  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  };
}

export function shouldDimGraphNode({
  focusNodeId,
  nodeId,
  connected,
  hovered,
}: {
  focusNodeId: string | null;
  nodeId: string;
  connected: boolean;
  hovered: boolean;
}): boolean {
  return Boolean(focusNodeId) && nodeId !== focusNodeId && !connected && !hovered;
}

export function graphDomainLabelY(
  domain: Pick<GraphDomainCluster, "position" | "radius">,
): number {
  return domain.position.y + graphDomainCoreRadius(domain) + 1.05;
}

export function graphDomainCoreRadius(
  domain: Pick<GraphDomainCluster, "radius">,
): number {
  return domain.radius;
}

export function graphAxisFrame(model: GraphSceneModel): GraphAxisFrame {
  return {
    origin: {
      x: model.axes.progress.minimum,
      y: model.axes.importance.minimum,
      z: (model.axes.entertainment.minimum + model.axes.entertainment.maximum) / 2,
    },
    xMinimum: model.axes.progress.minimum,
    xMaximum: model.axes.progress.maximum,
    yMinimum: model.axes.importance.minimum,
    yMaximum: model.axes.importance.maximum,
    zMinimum: model.axes.entertainment.minimum,
    zMaximum: model.axes.entertainment.maximum,
  };
}

export function graphNodeDisplayLabel(node: PositionedGraphNode): string {
  if (node.type !== "session" || !/^streamsense session$/i.test(node.label)) {
    return node.label;
  }
  const startedAt = node.metadata?.startedAt;
  return typeof startedAt === "string" && startedAt.trim()
    ? `${node.domainLabel} · ${formatDateTime(startedAt)}`
    : `${node.domainLabel} session`;
}

export function graphHierarchyGuides(
  model: GraphSceneModel,
): GraphHierarchyGuide[] {
  const domainByKey = new Map(
    model.domains.map((domain) => [domain.key, domain]),
  );
  const memoryGuides = model.domains.map((domain) => ({
    id: `hierarchy:memory:${domain.key}`,
    kind: "memory-domain" as const,
    domainKey: domain.key,
    sessionNodeId: null,
    source: model.memoryRoot.position,
    target: domain.position,
  }));
  const sessionGuides = model.nodes.flatMap((node) => {
    if (node.type !== "session" || node.domainKeys.length !== 1) return [];
    const domainKey = node.domainKeys[0]!;
    const domain = domainByKey.get(domainKey);
    if (!domain) return [];
    return [
      {
        id: `hierarchy:${domainKey}:${node.id}`,
        kind: "domain-session" as const,
        domainKey,
        sessionNodeId: node.id,
        source: domain.position,
        target: node.position,
      },
    ];
  });
  return [...memoryGuides, ...sessionGuides];
}

export function selectNonOverlappingGraphLabelIds(
  candidates: GraphLabelCollisionCandidate[],
  minimumGap = 6,
): Set<string> {
  const visibleIds = new Set<string>();
  const accepted: GraphLabelCollisionCandidate[] = [];
  const ordered = [...candidates].sort(
    (left, right) =>
      right.priority - left.priority || left.id.localeCompare(right.id),
  );

  for (const candidate of ordered) {
    const overlaps = accepted.some((other) =>
      rectanglesOverlap(candidate.bounds, other.bounds, minimumGap),
    );
    if (overlaps) continue;
    accepted.push(candidate);
    visibleIds.add(candidate.id);
  }

  return visibleIds;
}

type NodeVisual = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  label: HTMLElement;
  materials: Array<THREE.MeshStandardMaterial | THREE.MeshBasicMaterial>;
  baseOpacityByMaterial: Map<THREE.Material, number>;
};

type DomainVisual = {
  materials: THREE.Material[];
  baseOpacityByMaterial: Map<THREE.Material, number>;
};

export const createThreeGraphRenderer: GraphRendererFactory = ({
  container,
  canvas,
  model,
  reducedMotion,
  onSelect,
  onHover,
}) => {
  if (
    typeof WebGLRenderingContext === "undefined" &&
    typeof WebGL2RenderingContext === "undefined"
  ) {
    throw new Error("WebGL is unavailable.");
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = "graph-label-layer";
  labelRenderer.domElement.setAttribute("aria-hidden", "true");
  container.append(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(graphBackgroundColor());
  scene.fog = new THREE.FogExp2(
    graphBackgroundColor(),
    0.008,
  );

  const initialRectangle = container.getBoundingClientRect();
  const initialSize = resolveGraphRenderSize(
    initialRectangle.width || container.clientWidth,
    initialRectangle.height || container.clientHeight,
  );
  const initialAspect = initialSize.width / initialSize.height;
  const defaultView: GraphCameraView =
    model.projectionMode === "three-dimensional"
      ? "overview"
      : "progress-importance";
  let home = graphCameraPose(model, initialAspect, defaultView);
  let framedCameraView: GraphCameraView | null = defaultView;
  const camera = new THREE.PerspectiveCamera(
    45,
    initialAspect,
    0.1,
    Math.max(500, home.distance * 4),
  );
  camera.position.copy(home.position);
  camera.up.copy(home.up);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(home.target);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.08;
  // Pan is disabled because every pointer camera operation must have a visible
  // non-drag alternative. Orbit and zoom are mirrored by the controls above.
  controls.enablePan = false;
  controls.screenSpacePanning = false;
  controls.enableRotate = model.projectionMode === "three-dimensional";
  // Keep ordinary page scrolling from being trapped over the large canvas;
  // the visible Zoom in/out buttons provide the equivalent operation.
  controls.enableZoom = false;
  controls.autoRotate = false;
  controls.minDistance = 5;
  controls.maxDistance = Math.max(48, home.distance * 2.6);
  controls.update();

  scene.add(new THREE.HemisphereLight(0xd8efff, 0x10233f, 2.6));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.25);
  keyLight.position.set(8, 14, 12);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x5ce4d3, 1.25);
  fillLight.position.set(-12, 4, -8);
  scene.add(fillLight);

  const graphRoot = new THREE.Group();
  scene.add(graphRoot);

  const sphereGeometry = new THREE.SphereGeometry(1, 30, 20);
  const nodeVisuals = new Map<string, NodeVisual>();
  const domainVisuals = new Map<string, DomainVisual>();
  const nodeMeshes = new Map<string, THREE.Mesh>();
  const edgeMaterials = new Map<string, THREE.LineBasicMaterial>();
  const edgeBaseOpacity = new Map<string, number>();
  const hierarchyGuideMaterials = new Map<string, THREE.LineDashedMaterial>();
  const hierarchyGuides = graphHierarchyGuides(model);
  const domainLabels = new Map<string, HTMLElement>();
  let memoryRootLabel: HTMLElement | null = null;
  const disposableGeometries: THREE.BufferGeometry[] = [
    sphereGeometry,
  ];
  const disposableMaterials: THREE.Material[] = [];

  addAxisGuides({
    graphRoot,
    model,
    disposableGeometries,
    disposableMaterials,
  });

  const memoryMaterial = new THREE.MeshStandardMaterial({
    color: model.memoryRoot.color,
    emissive: 0x8eb5ff,
    emissiveIntensity: 0.52,
    roughness: 0.24,
    metalness: 0.28,
  });
  const memoryMesh = new THREE.Mesh(sphereGeometry, memoryMaterial);
  memoryMesh.position.set(
    model.memoryRoot.position.x,
    model.memoryRoot.position.y,
    model.memoryRoot.position.z,
  );
  memoryMesh.scale.setScalar(model.memoryRoot.radius);
  memoryMesh.renderOrder = 2;
  graphRoot.add(memoryMesh);
  disposableMaterials.push(memoryMaterial);

  const memoryHaloMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.38,
    wireframe: true,
    depthWrite: false,
  });
  const memoryHalo = new THREE.Mesh(sphereGeometry, memoryHaloMaterial);
  memoryHalo.position.copy(memoryMesh.position);
  memoryHalo.scale.setScalar(model.memoryRoot.radius * 1.2);
  memoryHalo.renderOrder = 3;
  graphRoot.add(memoryHalo);
  disposableMaterials.push(memoryHaloMaterial);

  memoryRootLabel = document.createElement("span");
  memoryRootLabel.className = "graph-memory-root-label";
  memoryRootLabel.textContent = model.memoryRoot.label;
  const memoryLabelObject = new CSS2DObject(memoryRootLabel);
  memoryLabelObject.position.set(
    model.memoryRoot.position.x,
    model.memoryRoot.position.y + model.memoryRoot.radius + 1.2,
    model.memoryRoot.position.z,
  );
  graphRoot.add(memoryLabelObject);

  for (const domain of model.domains) {
    const domainMaterials: THREE.Material[] = [];
    const baseOpacityByMaterial = new Map<THREE.Material, number>();
    const registerDomainMaterial = <Material extends THREE.Material>(
      material: Material,
    ): Material => {
      domainMaterials.push(material);
      baseOpacityByMaterial.set(
        material,
        "opacity" in material && typeof material.opacity === "number"
          ? material.opacity
          : 1,
      );
      disposableMaterials.push(material);
      return material;
    };

    const coreMaterial = registerDomainMaterial(
      new THREE.MeshStandardMaterial({
        color: domain.color,
        emissive: domain.color,
        emissiveIntensity: domain.isEmpty ? 0.08 : 0.62,
        roughness: 0.28,
        metalness: 0.2,
        wireframe: domain.isEmpty,
        transparent: domain.isEmpty,
        opacity: domain.isEmpty ? 0.22 : 1,
      }),
    );
    const core = new THREE.Mesh(sphereGeometry, coreMaterial);
    core.position.set(
      domain.position.x,
      domain.position.y,
      domain.position.z,
    );
    core.scale.setScalar(graphDomainCoreRadius(domain));
    core.renderOrder = 1;
    graphRoot.add(core);

    const coreHaloMaterial = registerDomainMaterial(
      new THREE.MeshBasicMaterial({
        color: domain.color,
        transparent: true,
        opacity: domain.isEmpty ? 0.12 : 0.34,
        wireframe: true,
        depthWrite: false,
      }),
    );
    const coreHalo = new THREE.Mesh(sphereGeometry, coreHaloMaterial);
    coreHalo.position.copy(core.position);
    coreHalo.scale.setScalar(graphDomainCoreRadius(domain) * 1.18);
    coreHalo.renderOrder = 2;
    graphRoot.add(coreHalo);

    domainVisuals.set(domain.key, {
      materials: domainMaterials,
      baseOpacityByMaterial,
    });

    const label = document.createElement("span");
    label.className = "graph-domain-label";
    label.classList.toggle("is-empty", domain.isEmpty);
    label.style.setProperty("--domain-color", `#${domain.color.toString(16).padStart(6, "0")}`);
    label.textContent = domain.isEmpty
      ? `${domain.label} · No saved sessions`
      : `${domain.label} · ${domain.sessionCount} ${domain.sessionCount === 1 ? "session" : "sessions"}`;
    const labelObject = new CSS2DObject(label);
    labelObject.position.set(
      domain.position.x,
      graphDomainLabelY(domain),
      domain.position.z,
    );
    graphRoot.add(labelObject);
    domainLabels.set(domain.key, label);
  }

  for (const guide of hierarchyGuides) {
    const domain = model.domains.find((item) => item.key === guide.domainKey);
    if (!domain) continue;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(guide.source.x, guide.source.y, guide.source.z),
      new THREE.Vector3(guide.target.x, guide.target.y, guide.target.z),
    ]);
    const material = new THREE.LineDashedMaterial({
      color: domain.color,
      dashSize: 0.24,
      gapSize: 0.16,
      transparent: true,
      opacity: domain.isEmpty
        ? guide.kind === "memory-domain" ? 0.2 : 0.12
        : guide.kind === "memory-domain" ? 0.66 : 0.8,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    line.renderOrder = 0;
    graphRoot.add(line);
    hierarchyGuideMaterials.set(guide.id, material);
    disposableGeometries.push(geometry);
    disposableMaterials.push(material);
  }

  for (const node of model.nodes) {
    const material = createNodeMaterial(node);
    const mesh = new THREE.Mesh(sphereGeometry, material);
    mesh.position.set(node.position.x, node.position.y, node.position.z);
    mesh.scale.setScalar(node.radius);
    mesh.userData.nodeId = node.id;
    mesh.userData.baseRadius = node.radius;
    graphRoot.add(mesh);
    nodeMeshes.set(node.id, mesh);
    disposableMaterials.push(material);

    const materials: Array<THREE.MeshStandardMaterial | THREE.MeshBasicMaterial> = [
      material,
    ];
    const baseOpacityByMaterial = new Map<THREE.Material, number>([
      [material, material.opacity],
    ]);
    for (const scale of haloScales(node)) {
      const haloMaterial = new THREE.MeshBasicMaterial({
        color: node.color,
        transparent: true,
        opacity: node.surface === "anchor" ? 0.34 : 0.26,
        wireframe: true,
        depthWrite: false,
      });
      const halo = new THREE.Mesh(sphereGeometry, haloMaterial);
      halo.position.copy(mesh.position);
      halo.scale.setScalar(node.radius * scale);
      halo.renderOrder = 2;
      graphRoot.add(halo);
      materials.push(haloMaterial);
      baseOpacityByMaterial.set(haloMaterial, haloMaterial.opacity);
      disposableMaterials.push(haloMaterial);
    }

    const label = document.createElement("span");
    label.className = `graph-node-label graph-node-label--${node.type}`;
    label.classList.toggle("is-default-visible", node.labelVisibleByDefault);
    label.textContent = graphNodeDisplayLabel(node);
    const labelObject = new CSS2DObject(label);
    labelObject.position.set(
      node.position.x,
      node.position.y + node.radius + 0.85,
      node.position.z,
    );
    graphRoot.add(labelObject);

    nodeVisuals.set(node.id, {
      mesh,
      label,
      materials,
      baseOpacityByMaterial,
    });
  }

  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const connectedNodeIdsByNodeId = createAdjacency(model);
  for (const edge of model.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;

    const geometry = new THREE.BufferGeometry().setFromPoints([
      vectorForNode(source),
      vectorForNode(target),
    ]);
    const material = createEdgeMaterial(edge);
    const line = new THREE.Line(geometry, material);
    if (material instanceof THREE.LineDashedMaterial) line.computeLineDistances();
    line.renderOrder = edge.semanticBridge ? 3 : 1;
    graphRoot.add(line);
    edgeMaterials.set(edge.id, material);
    edgeBaseOpacity.set(edge.id, material.opacity);
    disposableGeometries.push(geometry);
    disposableMaterials.push(material);
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hoveredNodeId: string | null = null;
  let selectedNodeId: string | null = null;
  let paused = reducedMotion;
  let controlsMoved = false;
  let suppressClickUntil = 0;
  let disposed = false;
  let frameRequest: number | null = null;
  let settlingFrames = 0;
  const suppressOverlappingLabels = () => {
    const elementsById = new Map<string, HTMLElement>();
    const candidates: GraphLabelCollisionCandidate[] = [];

    if (memoryRootLabel) {
      memoryRootLabel.style.visibility = "";
      elementsById.set("memory-root", memoryRootLabel);
    }
    for (const [domainKey, label] of domainLabels) {
      label.style.visibility = "";
      elementsById.set(`domain:${domainKey}`, label);
    }
    for (const [nodeId, visual] of nodeVisuals) {
      visual.label.style.visibility = "";
      elementsById.set(`node:${nodeId}`, visual.label);
    }

    for (const [id, element] of elementsById) {
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) <= 0 ||
        bounds.width <= 0 ||
        bounds.height <= 0
      ) {
        continue;
      }

      const nodeId = id.startsWith("node:") ? id.slice(5) : null;
      const node = nodeId ? nodeById.get(nodeId) : null;
      const priority = element.classList.contains("is-selected")
        ? 1_000
        : element.classList.contains("is-hovered")
          ? 950
          : id === "memory-root"
            ? 900
          : id.startsWith("domain:")
            ? element.classList.contains("is-dimmed")
              ? 420
              : 850
            : node?.type === "session"
              ? 800
              : element.classList.contains("is-default-visible")
                ? 650
                : 500;
      candidates.push({
        id,
        priority,
        bounds: {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
        },
      });
    }

    const visibleIds = selectNonOverlappingGraphLabelIds(candidates);
    for (const candidate of candidates) {
      const element = elementsById.get(candidate.id);
      if (element && !visibleIds.has(candidate.id)) {
        element.style.visibility = "hidden";
      }
    }
  };

  const render = () => {
    if (disposed) return;
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    suppressOverlappingLabels();
  };

  const requestRender = (frames = 1) => {
    if (disposed) return;
    settlingFrames = Math.max(settlingFrames, paused ? 1 : frames);
    if (frameRequest !== null) return;
    frameRequest = window.requestAnimationFrame(tick);
  };

  const tick = () => {
    if (disposed) {
      frameRequest = null;
      return;
    }
    if (!paused && controls.enableDamping) controls.update();
    render();
    settlingFrames -= 1;
    frameRequest = null;
    if (settlingFrames > 0) frameRequest = window.requestAnimationFrame(tick);
  };

  const updateGraphAppearance = () => {
    const focusNodeId = selectedNodeId ?? hoveredNodeId;
    const connectedNodeIds = focusNodeId
      ? new Set(connectedNodeIdsByNodeId.get(focusNodeId) ?? [])
      : new Set<string>();
    const focusNode = focusNodeId ? nodeById.get(focusNodeId) : null;

    for (const [nodeId, visual] of nodeVisuals) {
      const baseRadius = Number(visual.mesh.userData.baseRadius) || 1;
      const selected = nodeId === selectedNodeId;
      const hovered = nodeId === hoveredNodeId;
      const connected = connectedNodeIds.has(nodeId);
      // Pointer exploration stays visible even when a different node is
      // selected. The selected branch still controls relationship emphasis.
      const unrelated = shouldDimGraphNode({
        focusNodeId,
        nodeId,
        connected,
        hovered,
      });
      visual.mesh.scale.setScalar(
        baseRadius *
          (selected ? 1.34 : hovered ? 1.18 : connected ? 1.08 : unrelated ? 0.86 : 1),
      );

      for (const material of visual.materials) {
        const baseOpacity = visual.baseOpacityByMaterial.get(material) ?? 1;
        material.opacity = unrelated ? Math.max(0.07, baseOpacity * 0.16) : baseOpacity;
        material.transparent = true;
        material.needsUpdate = true;
      }
      const material = visual.mesh.material;
      material.emissiveIntensity = selected
        ? 0.72
        : hovered
          ? 0.42
          : connected
            ? 0.22
            : unrelated
              ? 0.02
              : 0.1;

      visual.label.classList.toggle("is-selected", selected);
      visual.label.classList.toggle("is-hovered", hovered);
      visual.label.classList.toggle("is-dimmed", unrelated);
    }

    for (const edge of model.edges) {
      const material = edgeMaterials.get(edge.id);
      if (!material) continue;
      const connected =
        Boolean(focusNodeId) &&
        (edge.source === focusNodeId || edge.target === focusNodeId);
      material.opacity = focusNodeId
        ? connected
          ? 0.96
          : 0.05
        : edgeBaseOpacity.get(edge.id) ?? 0.14;
      material.needsUpdate = true;
    }

    for (const [domainKey, label] of domainLabels) {
      const unrelated =
        Boolean(focusNode) && !focusNode!.domainKeys.includes(domainKey);
      label.classList.toggle("is-dimmed", unrelated);
    }
    for (const [domainKey, visual] of domainVisuals) {
      const unrelated =
        Boolean(focusNode) && !focusNode!.domainKeys.includes(domainKey);
      for (const material of visual.materials) {
        const baseOpacity = visual.baseOpacityByMaterial.get(material) ?? 1;
        material.opacity = unrelated
          ? Math.max(0.012, baseOpacity * 0.16)
          : baseOpacity;
        material.transparent = material.opacity < 1;
        material.needsUpdate = true;
      }
    }
    for (const guide of hierarchyGuides) {
      const material = hierarchyGuideMaterials.get(guide.id);
      if (!material) continue;
      const sameDomain = focusNode?.domainKeys.includes(guide.domainKey) ?? false;
      const selectedSession = focusNodeId === guide.sessionNodeId;
      material.opacity = focusNodeId
        ? selectedSession
          ? 0.98
          : sameDomain
            ? 0.42
            : 0.05
        : guide.kind === "memory-domain"
          ? 0.66
          : 0.8;
      material.needsUpdate = true;
    }
    requestRender(paused || reducedMotion ? 1 : 10);
  };

  const hitTest = (event: PointerEvent): string | null => {
    const rectangle = canvas.getBoundingClientRect();
    if (!rectangle.width || !rectangle.height) return null;
    pointer.x = ((event.clientX - rectangle.left) / rectangle.width) * 2 - 1;
    pointer.y = -((event.clientY - rectangle.top) / rectangle.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([...nodeMeshes.values()], false)[0];
    return typeof hit?.object.userData.nodeId === "string"
      ? hit.object.userData.nodeId
      : null;
  };

  const handlePointerMove = (event: PointerEvent) => {
    const nextHoveredNodeId = hitTest(event);
    if (nextHoveredNodeId === hoveredNodeId) return;
    hoveredNodeId = nextHoveredNodeId;
    canvas.style.cursor = hoveredNodeId
      ? "pointer"
      : model.projectionMode === "three-dimensional"
        ? "grab"
        : "default";
    onHover(hoveredNodeId);
    updateGraphAppearance();
  };

  const handlePointerLeave = () => {
    if (!hoveredNodeId) return;
    hoveredNodeId = null;
    canvas.style.cursor =
      model.projectionMode === "three-dimensional" ? "grab" : "default";
    onHover(null);
    updateGraphAppearance();
  };

  const handleClick = (event: PointerEvent) => {
    if (performance.now() < suppressClickUntil) return;
    const nodeId = hitTest(event);
    if (!nodeId) return;
    selectedNodeId = nodeId;
    updateGraphAppearance();
    onSelect(nodeId);
  };

  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerleave", handlePointerLeave);
  canvas.addEventListener("click", handleClick);

  const handleControlStart = () => {
    framedCameraView = null;
    controlsMoved = false;
    requestRender(reducedMotion || paused ? 1 : 80);
  };
  const handleControlChange = () => {
    controlsMoved = true;
    requestRender(reducedMotion || paused ? 1 : 12);
  };
  const handleControlEnd = () => {
    if (controlsMoved) suppressClickUntil = performance.now() + 180;
    requestRender(reducedMotion || paused ? 1 : 24);
  };
  controls.addEventListener("start", handleControlStart);
  controls.addEventListener("change", handleControlChange);
  controls.addEventListener("end", handleControlEnd);

  const resize = () => {
    if (disposed) return;
    const rectangle = container.getBoundingClientRect();
    const { width, height } = resolveGraphRenderSize(
      rectangle.width || container.clientWidth,
      rectangle.height || container.clientHeight,
    );
    const nextAspect = width / height;
    home = graphCameraPose(model, nextAspect, defaultView);
    camera.aspect = nextAspect;
    camera.far = Math.max(500, home.distance * 4);
    camera.updateProjectionMatrix();
    controls.maxDistance = Math.max(48, home.distance * 2.6);
    if (framedCameraView) {
      const pose = graphCameraPose(model, nextAspect, framedCameraView);
      camera.position.copy(pose.position);
      camera.up.copy(pose.up);
      controls.target.copy(pose.target);
      controls.update();
    }
    renderer.setSize(width, height, false);
    labelRenderer.setSize(width, height);
    render();
  };

  const resizeObserver =
    typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  if (resizeObserver) resizeObserver.observe(container);
  else window.addEventListener("resize", resize);
  resize();
  requestRender(1);

  const setCameraView = (view: GraphCameraView) => {
    const resolvedView =
      model.projectionMode === "two-dimensional"
        ? "progress-importance"
        : view;
    const pose = graphCameraPose(model, camera.aspect, resolvedView);
    camera.position.copy(pose.position);
    camera.up.copy(pose.up);
    controls.target.copy(pose.target);
    framedCameraView = resolvedView;
    controls.update();
    requestRender(reducedMotion || paused ? 1 : 18);
  };

  const zoomCamera = (factor: number) => {
    framedCameraView = null;
    const offset = camera.position.clone().sub(controls.target);
    const distance = THREE.MathUtils.clamp(
      offset.length() * factor,
      controls.minDistance,
      controls.maxDistance,
    );
    camera.position.copy(controls.target).add(offset.setLength(distance));
    camera.lookAt(controls.target);
    controls.update();
    requestRender(reducedMotion || paused ? 1 : 18);
  };

  return {
    resetCamera() {
      setCameraView(defaultView);
    },
    setCameraView,
    zoomCamera,
    selectNode(nodeId) {
      selectedNodeId = nodeId && nodeMeshes.has(nodeId) ? nodeId : null;
      updateGraphAppearance();
    },
    setPaused(nextPaused) {
      paused = nextPaused || reducedMotion;
      controls.enableDamping = !paused && !reducedMotion;
      if (paused && frameRequest !== null) {
        window.cancelAnimationFrame(frameRequest);
        frameRequest = null;
        settlingFrames = 0;
      }
      requestRender(1);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frameRequest !== null) window.cancelAnimationFrame(frameRequest);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("click", handleClick);
      controls.removeEventListener("start", handleControlStart);
      controls.removeEventListener("change", handleControlChange);
      controls.removeEventListener("end", handleControlEnd);
      controls.dispose();
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener("resize", resize);
      disposableGeometries.forEach((geometry) => geometry.dispose());
      disposableMaterials.forEach((material) => material.dispose());
      labelRenderer.domElement.remove();
      graphRoot.clear();
      scene.clear();
      renderer.renderLists.dispose();
      renderer.dispose();
    },
  };
};

function createNodeMaterial(
  node: PositionedGraphNode,
): THREE.MeshStandardMaterial {
  const entity = node.surface === "entity";
  const topic = node.surface === "topic";
  return new THREE.MeshStandardMaterial({
    color: node.color,
    emissive: node.color,
    emissiveIntensity:
      node.surface === "anchor" ? 0.28 : node.surface === "event" ? 0.18 : 0.14,
    roughness: node.surface === "anchor" ? 0.34 : 0.5,
    metalness: node.surface === "anchor" ? 0.2 : 0.08,
    wireframe: entity,
    transparent: true,
    opacity: topic ? 0.68 : entity ? 0.92 : 1,
    depthWrite: !topic,
  });
}

function haloScales(node: PositionedGraphNode): number[] {
  if (node.surface === "anchor") return [1.24, 1.46];
  if (node.surface === "entity") return [1.2];
  if (node.surface === "topic") return [1.3];
  return [];
}

function createEdgeMaterial(
  edge: PositionedGraphEdge,
): THREE.LineBasicMaterial {
  const { color, opacity } = graphEdgePresentation(edge.type);
  if (edge.type === "semantic_similarity") {
    return new THREE.LineDashedMaterial({
      color,
      dashSize: 0.36,
      gapSize: 0.24,
      opacity,
      transparent: true,
      depthWrite: false,
    });
  }
  if (edge.type === "shared_topic") {
    return new THREE.LineDashedMaterial({
      color,
      dashSize: 0.16,
      gapSize: 0.2,
      opacity,
      transparent: true,
      depthWrite: false,
    });
  }
  return new THREE.LineBasicMaterial({
    color,
    opacity,
    transparent: true,
    depthWrite: false,
  });
}

function edgeColor(type: PositionedGraphEdge["type"]): number {
  switch (type) {
    case "same_session":
      return 0x5ce4d3;
    case "temporal_relation":
      return 0xffd166;
    case "shared_entity":
      return 0x9bc1ff;
    case "shared_topic":
      return 0xe1b6ff;
    default:
      return 0xff8fd8;
  }
}

function createAdjacency(model: GraphSceneModel): Map<string, string[]> {
  const adjacency = new Map(
    model.nodes.map((node) => [node.id, [] as string[]]),
  );
  for (const edge of model.edges) {
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }
  return adjacency;
}

function vectorForNode(node: PositionedGraphNode): THREE.Vector3 {
  return new THREE.Vector3(node.position.x, node.position.y, node.position.z);
}

function addAxisGuides({
  graphRoot,
  model,
  disposableGeometries,
  disposableMaterials,
}: {
  graphRoot: THREE.Group;
  model: GraphSceneModel;
  disposableGeometries: THREE.BufferGeometry[];
  disposableMaterials: THREE.Material[];
}): void {
  const frame = graphAxisFrame(model);
  const entertainmentAxisZ =
    model.domains.length > 1 ? frame.zMinimum - 2.3 : frame.zMinimum;
  const addLine = (
    start: THREE.Vector3,
    end: THREE.Vector3,
    color: number,
    opacity: number,
  ) => {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = -2;
    graphRoot.add(line);
    disposableGeometries.push(geometry);
    disposableMaterials.push(material);
  };
  const addLabel = (
    text: string,
    className: string,
    position: THREE.Vector3,
  ) => {
    const label = document.createElement("span");
    label.className = className;
    label.textContent = text;
    const labelObject = new CSS2DObject(label);
    labelObject.position.copy(position);
    graphRoot.add(labelObject);
  };

  addLine(
    new THREE.Vector3(frame.xMinimum, frame.yMinimum, entertainmentAxisZ),
    new THREE.Vector3(frame.xMaximum, frame.yMinimum, entertainmentAxisZ),
    0xff8f8f,
    0.46,
  );
  for (const tick of model.axes.progress.ticks) {
    addLine(
      new THREE.Vector3(tick.position, frame.yMinimum - 0.24, entertainmentAxisZ),
      new THREE.Vector3(tick.position, frame.yMinimum + 0.24, entertainmentAxisZ),
      0xff8f8f,
      0.54,
    );
    addLabel(
      tick.label,
      "graph-axis-tick graph-axis-tick--progress",
      new THREE.Vector3(tick.position, frame.yMinimum - 0.92, entertainmentAxisZ),
    );
  }
  addLabel(
    model.axes.progress.label,
    "graph-axis-title graph-axis-title--progress",
    new THREE.Vector3(frame.xMaximum + 1.7, frame.yMinimum, entertainmentAxisZ),
  );

  addLine(
    new THREE.Vector3(frame.xMinimum, frame.yMinimum, entertainmentAxisZ),
    new THREE.Vector3(frame.xMinimum, frame.yMaximum, entertainmentAxisZ),
    0x7ee7a8,
    0.46,
  );
  for (const tick of model.axes.importance.ticks) {
    addLine(
      new THREE.Vector3(frame.xMinimum - 0.24, tick.position, entertainmentAxisZ),
      new THREE.Vector3(frame.xMinimum + 0.24, tick.position, entertainmentAxisZ),
      0x7ee7a8,
      0.54,
    );
    addLabel(
      tick.label,
      "graph-axis-tick graph-axis-tick--importance",
      new THREE.Vector3(frame.xMinimum - 1.15, tick.position, entertainmentAxisZ),
    );
  }
  addLabel(
    model.axes.importance.label,
    "graph-axis-title graph-axis-title--importance",
    new THREE.Vector3(frame.xMinimum, frame.yMaximum + 1.25, entertainmentAxisZ),
  );

  for (const domain of model.domains) {
    const laneCorners = [
      new THREE.Vector3(frame.xMinimum, frame.yMinimum, domain.lanePosition),
      new THREE.Vector3(frame.xMaximum, frame.yMinimum, domain.lanePosition),
      new THREE.Vector3(frame.xMaximum, frame.yMaximum, domain.lanePosition),
      new THREE.Vector3(frame.xMinimum, frame.yMaximum, domain.lanePosition),
      new THREE.Vector3(frame.xMinimum, frame.yMinimum, domain.lanePosition),
    ];
    const laneGeometry = new THREE.BufferGeometry().setFromPoints(laneCorners);
    const laneMaterial = new THREE.LineBasicMaterial({
      color: domain.color,
      transparent: true,
      opacity: domain.isEmpty ? 0.12 : model.domains.length > 1 ? 0.28 : 0.2,
      depthWrite: false,
    });
    const laneOutline = new THREE.Line(laneGeometry, laneMaterial);
    laneOutline.renderOrder = -3;
    graphRoot.add(laneOutline);
    disposableGeometries.push(laneGeometry);
    disposableMaterials.push(laneMaterial);

    for (const tick of model.axes.progress.ticks.slice(1, -1)) {
      addLine(
        new THREE.Vector3(tick.position, frame.yMinimum, domain.lanePosition),
        new THREE.Vector3(tick.position, frame.yMaximum, domain.lanePosition),
        domain.color,
        domain.isEmpty ? 0.035 : 0.075,
      );
    }
    for (const tick of model.axes.importance.ticks.filter(
      (item) => typeof item.value === "number",
    )) {
      addLine(
        new THREE.Vector3(frame.xMinimum, tick.position, domain.lanePosition),
        new THREE.Vector3(frame.xMaximum, tick.position, domain.lanePosition),
        domain.color,
        domain.isEmpty ? 0.035 : 0.075,
      );
    }
    addLine(
      new THREE.Vector3(frame.xMinimum, frame.yMinimum, domain.lanePosition),
      new THREE.Vector3(frame.xMaximum, frame.yMinimum, domain.lanePosition),
      domain.color,
      domain.isEmpty ? 0.16 : 0.34,
    );
  }

  if (model.domains.length > 1) {
    addLine(
      new THREE.Vector3(frame.xMinimum, frame.yMinimum, frame.zMinimum),
      new THREE.Vector3(frame.xMinimum, frame.yMinimum, frame.zMaximum),
      0x8eb5ff,
      0.46,
    );
    for (const tick of model.axes.entertainment.ticks) {
      addLine(
        new THREE.Vector3(frame.xMinimum - 0.24, frame.yMinimum, tick.position),
        new THREE.Vector3(frame.xMinimum + 0.24, frame.yMinimum, tick.position),
        0x8eb5ff,
        0.54,
      );
      addLabel(
        tick.label,
        "graph-axis-tick graph-axis-tick--entertainment",
        new THREE.Vector3(frame.xMinimum - 0.7, frame.yMinimum - 0.85, tick.position),
      );
    }
    addLabel(
      model.axes.entertainment.label,
      "graph-axis-title graph-axis-title--entertainment",
      new THREE.Vector3(frame.xMinimum, frame.yMinimum, frame.zMaximum + 2.2),
    );
  }
}

export function graphCameraHome(
  model: GraphSceneModel,
  aspect = 1,
): {
  position: THREE.Vector3;
  target: THREE.Vector3;
  distance: number;
  up: THREE.Vector3;
} {
  return graphCameraPose(
    model,
    aspect,
    model.projectionMode === "three-dimensional"
      ? "overview"
      : "progress-importance",
  );
}

export function graphCameraPose(
  model: GraphSceneModel,
  aspect = 1,
  view: GraphCameraView = "overview",
): {
  position: THREE.Vector3;
  target: THREE.Vector3;
  distance: number;
  up: THREE.Vector3;
} {
  if (model.nodes.length === 0 && model.domains.length === 0) {
    const target = new THREE.Vector3(0, 0, 0);
    const direction = cameraDirection(view);
    return {
      position: target.clone().add(direction.multiplyScalar(19)),
      target,
      distance: 19,
      up: cameraUp(view),
    };
  }

  const bounds = graphSceneBounds(model, true);
  const target = bounds.getCenter(new THREE.Vector3());
  const verticalFieldOfView = THREE.MathUtils.degToRad(45);
  const safeAspect = Math.max(0.1, aspect);
  const horizontalFieldOfView =
    2 * Math.atan(Math.tan(verticalFieldOfView / 2) * safeAspect);
  const direction = cameraDirection(view);
  const up = cameraUp(view);
  const right = new THREE.Vector3().crossVectors(up, direction).normalize();
  const screenUp = new THREE.Vector3().crossVectors(direction, right).normalize();
  const tangentHorizontal = Math.tan(horizontalFieldOfView / 2);
  const tangentVertical = Math.tan(verticalFieldOfView / 2);
  let distance = 12;
  for (const corner of graphBoundsCorners(bounds)) {
    const relative = corner.sub(target);
    const depth = relative.dot(direction);
    distance = Math.max(
      distance,
      depth + Math.abs(relative.dot(right)) / tangentHorizontal,
      depth + Math.abs(relative.dot(screenUp)) / tangentVertical,
    );
  }
  distance *= 1.12;
  return {
    position: target.clone().add(direction.multiplyScalar(distance)),
    target,
    distance,
    up,
  };
}

function cameraDirection(view: GraphCameraView): THREE.Vector3 {
  switch (view) {
    case "importance-entertainment":
      return new THREE.Vector3(1, 0, 0);
    case "progress-entertainment":
      return new THREE.Vector3(0, 1, 0);
    case "progress-importance":
      return new THREE.Vector3(0, 0, 1);
    default:
      // Preserve progress as the dominant horizontal direction while giving
      // the five entertainment planes enough parallax to read as real depth.
      return new THREE.Vector3(0.38, 0.3, 1).normalize();
  }
}

function cameraUp(view: GraphCameraView): THREE.Vector3 {
  return view === "progress-entertainment"
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0);
}

function graphSceneBounds(
  model: GraphSceneModel,
  includeDomainLabels: boolean,
): THREE.Box3 {
  const bounds = new THREE.Box3();
  const memoryCenter = new THREE.Vector3(
    model.memoryRoot.position.x,
    model.memoryRoot.position.y,
    model.memoryRoot.position.z,
  );
  const memoryExtent = new THREE.Vector3(
    model.memoryRoot.radius,
    model.memoryRoot.radius + (includeDomainLabels ? 1.8 : 0),
    model.memoryRoot.radius,
  );
  bounds.expandByPoint(memoryCenter.clone().sub(memoryExtent));
  bounds.expandByPoint(memoryCenter.clone().add(memoryExtent));
  model.nodes.forEach((node) => {
    const center = new THREE.Vector3(
      node.position.x,
      node.position.y,
      node.position.z,
    );
    const extent = new THREE.Vector3(node.radius, node.radius, node.radius);
    bounds.expandByPoint(center.clone().sub(extent));
    bounds.expandByPoint(center.clone().add(extent));
  });
  model.domains.forEach((domain) => {
    const radius = graphDomainCoreRadius(domain);
    bounds.expandByPoint(
      new THREE.Vector3(
        domain.position.x - radius,
        domain.position.y - radius,
        domain.position.z - radius,
      ),
    );
    bounds.expandByPoint(
      new THREE.Vector3(
        domain.position.x + radius,
        includeDomainLabels ? graphDomainLabelY(domain) + 0.8 : domain.position.y + radius,
        domain.position.z + radius,
      ),
    );
  });
  return bounds;
}

function graphBoundsCorners(bounds: THREE.Box3): THREE.Vector3[] {
  const { min, max } = bounds;
  return [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ];
}

function rectanglesOverlap(
  left: GraphLabelCollisionCandidate["bounds"],
  right: GraphLabelCollisionCandidate["bounds"],
  minimumGap: number,
): boolean {
  return !(
    left.right + minimumGap <= right.left ||
    right.right + minimumGap <= left.left ||
    left.bottom + minimumGap <= right.top ||
    right.bottom + minimumGap <= left.top
  );
}
