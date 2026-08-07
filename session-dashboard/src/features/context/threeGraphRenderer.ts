import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/addons/renderers/CSS2DRenderer.js";

import type {
  GraphNodeShape,
  GraphSceneModel,
  PositionedGraphNode,
} from "./graphModel";

export type GraphRendererController = {
  resetCamera: () => void;
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
  scene.background = new THREE.Color(0x081426);
  scene.fog = new THREE.FogExp2(0x081426, 0.018);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  const home = cameraHome(model);
  camera.position.copy(home.position);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(home.target);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.autoRotate = false;
  controls.minDistance = 5;
  controls.maxDistance = Math.max(45, home.distance * 3);
  controls.update();

  scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x17253d, 2.4));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
  keyLight.position.set(8, 14, 12);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x5ce4d3, 1.1);
  fillLight.position.set(-12, 4, -8);
  scene.add(fillLight);

  const graphRoot = new THREE.Group();
  scene.add(graphRoot);

  const nodeMeshes = new Map<string, THREE.Mesh>();
  const nodeLabels = new Map<string, HTMLElement>();
  const disposableGeometries: THREE.BufferGeometry[] = [];
  const disposableMaterials: THREE.Material[] = [];

  for (const node of model.nodes) {
    const geometry = createNodeGeometry(node.shape);
    const material = new THREE.MeshStandardMaterial({
      color: node.color,
      emissive: node.color,
      emissiveIntensity: 0.08,
      roughness: 0.55,
      metalness: 0.08,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(node.position.x, node.position.y, node.position.z);
    mesh.scale.setScalar(node.radius);
    mesh.userData.nodeId = node.id;
    mesh.userData.baseRadius = node.radius;
    graphRoot.add(mesh);
    nodeMeshes.set(node.id, mesh);
    disposableGeometries.push(geometry);
    disposableMaterials.push(material);

    const label = document.createElement("span");
    label.className = `graph-node-label graph-node-label--${node.type}`;
    label.classList.toggle(
      "is-default-visible",
      node.labelVisibleByDefault,
    );
    label.textContent = node.label;
    const labelObject = new CSS2DObject(label);
    labelObject.position.set(
      node.position.x,
      node.position.y + node.radius + 0.62,
      node.position.z,
    );
    graphRoot.add(labelObject);
    nodeLabels.set(node.id, label);
  }

  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  for (const edge of model.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;

    const geometry = new THREE.BufferGeometry().setFromPoints([
      vectorForNode(source),
      vectorForNode(target),
    ]);
    const material = edge.semanticBridge
      ? new THREE.LineDashedMaterial({
          color: 0xff8fd8,
          dashSize: 0.32,
          gapSize: 0.2,
          opacity: 0.45 + edge.weight * 0.45,
          transparent: true,
        })
      : new THREE.LineBasicMaterial({
          color: edgeColor(edge.type),
          opacity: 0.2 + edge.weight * 0.42,
          transparent: true,
        });
    const line = new THREE.Line(geometry, material);
    if (edge.semanticBridge) line.computeLineDistances();
    graphRoot.add(line);
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

  const render = () => {
    if (disposed) return;
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
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

  const updateNodeAppearance = () => {
    for (const [nodeId, mesh] of nodeMeshes) {
      const baseRadius = Number(mesh.userData.baseRadius) || 1;
      const selected = nodeId === selectedNodeId;
      const hovered = nodeId === hoveredNodeId;
      mesh.scale.setScalar(baseRadius * (selected ? 1.3 : hovered ? 1.16 : 1));
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = selected ? 0.62 : hovered ? 0.34 : 0.08;
      const label = nodeLabels.get(nodeId);
      label?.classList.toggle("is-selected", selected);
      label?.classList.toggle("is-hovered", hovered);
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
    updateNodeAppearance();
  };

  const handlePointerLeave = () => {
    if (!hoveredNodeId) return;
    hoveredNodeId = null;
    canvas.style.cursor = "grab";
    onHover(null);
    updateNodeAppearance();
  };

  const handleClick = (event: PointerEvent) => {
    if (performance.now() < suppressClickUntil) return;
    const nodeId = hitTest(event);
    if (!nodeId) return;
    selectedNodeId = nodeId;
    updateNodeAppearance();
    onSelect(nodeId);
  };

  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerleave", handlePointerLeave);
  canvas.addEventListener("click", handleClick);

  const handleControlStart = () => {
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
    const width = Math.max(320, Math.floor(rectangle.width || container.clientWidth || 720));
    const height = Math.max(320, Math.floor(rectangle.height || container.clientHeight || 500));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
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

  return {
    resetCamera() {
      camera.position.copy(home.position);
      controls.target.copy(home.target);
      controls.update();
      requestRender(reducedMotion || paused ? 1 : 24);
    },
    selectNode(nodeId) {
      selectedNodeId = nodeId && nodeMeshes.has(nodeId) ? nodeId : null;
      updateNodeAppearance();
    },
    setPaused(nextPaused) {
      paused = nextPaused || reducedMotion;
      controls.enableDamping = !paused && !reducedMotion;
      if (paused && frameRequest !== null) {
        window.cancelAnimationFrame(frameRequest);
        frameRequest = null;
        settlingFrames = 0;
      }
      requestRender(paused ? 1 : 24);
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
      renderer.dispose();
    },
  };
};

function createNodeGeometry(shape: GraphNodeShape): THREE.BufferGeometry {
  switch (shape) {
    case "sphere":
      return new THREE.SphereGeometry(1, 28, 18);
    case "box":
      return new THREE.BoxGeometry(1.35, 1.35, 1.35);
    case "octahedron":
      return new THREE.OctahedronGeometry(1.08, 0);
    case "torus":
      return new THREE.TorusGeometry(0.78, 0.26, 14, 32);
  }
}

function edgeColor(type: string): number {
  switch (type) {
    case "same_session":
      return 0x5ce4d3;
    case "temporal_relation":
      return 0xf6b73c;
    case "shared_entity":
      return 0x6da7ff;
    case "shared_topic":
      return 0xd58cff;
    default:
      return 0xb9c8dd;
  }
}

function vectorForNode(node: PositionedGraphNode): THREE.Vector3 {
  return new THREE.Vector3(node.position.x, node.position.y, node.position.z);
}

function cameraHome(model: GraphSceneModel): {
  position: THREE.Vector3;
  target: THREE.Vector3;
  distance: number;
} {
  if (model.nodes.length === 0) {
    return {
      position: new THREE.Vector3(0, 10, 18),
      target: new THREE.Vector3(0, 0, 0),
      distance: 20,
    };
  }

  const bounds = new THREE.Box3();
  model.nodes.forEach((node) => bounds.expandByPoint(vectorForNode(node)));
  const target = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const distance = Math.max(13, size.length() * 1.2);
  return {
    position: target.clone().add(new THREE.Vector3(0, distance * 0.55, distance)),
    target,
    distance,
  };
}
