import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/addons/renderers/CSS2DRenderer.js";

import type {
  GraphDomainCluster,
  GraphSceneModel,
  PositionedGraphEdge,
  PositionedGraphNode,
} from "./graphModel";

export type GraphRendererController = {
  resetCamera: () => void;
  rotateCamera: (horizontalRadians: number, verticalRadians: number) => void;
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

const DEFAULT_GRAPH_BACKGROUND = 0x07111f;

export function graphBackgroundColor(): number {
  return DEFAULT_GRAPH_BACKGROUND;
}

export function graphEdgePresentation(
  type: PositionedGraphEdge["type"],
): { color: number; opacity: number } {
  return {
    color: edgeColor(type),
    // Every supplied edge color clears 3:1 against the single scene theme.
    opacity: 0.6,
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
  return domain.position.y + domain.radius + 1.25;
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
  let home = graphCameraHome(model, initialAspect);
  let cameraAtHome = true;
  const camera = new THREE.PerspectiveCamera(
    45,
    initialAspect,
    0.1,
    Math.max(500, home.distance * 4),
  );
  camera.position.copy(home.position);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(home.target);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.08;
  // Pan is disabled because every pointer camera operation must have a visible
  // non-drag alternative. Orbit and zoom are mirrored by the controls above.
  controls.enablePan = false;
  controls.screenSpacePanning = false;
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
  const nodeMeshes = new Map<string, THREE.Mesh>();
  const edgeMaterials = new Map<string, THREE.LineBasicMaterial>();
  const edgeBaseOpacity = new Map<string, number>();
  const domainLabels = new Map<string, HTMLElement>();
  const disposableGeometries: THREE.BufferGeometry[] = [sphereGeometry];
  const disposableMaterials: THREE.Material[] = [];

  for (const domain of model.domains) {
    const label = document.createElement("span");
    label.className = "graph-domain-label";
    label.style.setProperty("--domain-color", `#${domain.color.toString(16).padStart(6, "0")}`);
    label.textContent = `${domain.label} · ${domain.sessionCount} ${domain.sessionCount === 1 ? "session" : "sessions"}`;
    const labelObject = new CSS2DObject(label);
    labelObject.position.set(
      domain.position.x,
      graphDomainLabelY(domain),
      domain.position.z,
    );
    graphRoot.add(labelObject);
    domainLabels.set(domain.key, label);
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
    label.textContent = node.label;
    const labelObject = new CSS2DObject(label);
    labelObject.position.set(
      node.position.x,
      node.position.y + node.radius + 0.62,
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
    canvas.style.cursor = hoveredNodeId ? "pointer" : "grab";
    onHover(hoveredNodeId);
    updateGraphAppearance();
  };

  const handlePointerLeave = () => {
    if (!hoveredNodeId) return;
    hoveredNodeId = null;
    canvas.style.cursor = "grab";
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
    cameraAtHome = false;
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
    home = graphCameraHome(model, nextAspect);
    camera.aspect = nextAspect;
    camera.far = Math.max(500, home.distance * 4);
    camera.updateProjectionMatrix();
    controls.maxDistance = Math.max(48, home.distance * 2.6);
    if (cameraAtHome) {
      camera.position.copy(home.position);
      controls.target.copy(home.target);
      controls.update();
      cameraAtHome = true;
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

  const rotateCamera = (horizontalRadians: number, verticalRadians: number) => {
    cameraAtHome = false;
    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += horizontalRadians;
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi + verticalRadians,
      0.18,
      Math.PI - 0.18,
    );
    camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
    camera.lookAt(controls.target);
    controls.update();
    requestRender(reducedMotion || paused ? 1 : 18);
  };

  const zoomCamera = (factor: number) => {
    cameraAtHome = false;
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
      camera.position.copy(home.position);
      controls.target.copy(home.target);
      controls.update();
      cameraAtHome = true;
      requestRender(reducedMotion || paused ? 1 : 24);
    },
    rotateCamera,
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

export function graphCameraHome(
  model: GraphSceneModel,
  aspect = 1,
): {
  position: THREE.Vector3;
  target: THREE.Vector3;
  distance: number;
} {
  if (model.nodes.length === 0) {
    return {
      position: new THREE.Vector3(0, 6, 18),
      target: new THREE.Vector3(0, 0, 0),
      distance: 19,
    };
  }

  const bounds = new THREE.Box3();
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
    bounds.expandByPoint(
      new THREE.Vector3(
        domain.position.x - domain.radius,
        domain.position.y - domain.radius,
        domain.position.z - domain.radius,
      ),
    );
    bounds.expandByPoint(
      new THREE.Vector3(
        domain.position.x + domain.radius,
        graphDomainLabelY(domain) + 0.8,
        domain.position.z + domain.radius,
      ),
    );
  });
  const target = bounds.getCenter(new THREE.Vector3());
  const boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
  const verticalFieldOfView = THREE.MathUtils.degToRad(45);
  const safeAspect = Math.max(0.1, aspect);
  const horizontalFieldOfView =
    2 * Math.atan(Math.tan(verticalFieldOfView / 2) * safeAspect);
  const limitingFieldOfView = Math.min(
    verticalFieldOfView,
    horizontalFieldOfView,
  );
  const distance = Math.max(
    12,
    (boundingSphere.radius / Math.sin(limitingFieldOfView / 2)) * 1.18,
  );
  const cameraDirection = new THREE.Vector3(0, 0.28, 1).normalize();
  return {
    position: target.clone().add(cameraDirection.multiplyScalar(distance)),
    target,
    distance,
  };
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
