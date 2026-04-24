import * as THREE from "three";
import { Rig, type RigDefinition } from "../core/index.js";
import { ThreeSkeletonBinder, createRigViewport, type RigViewport } from "../three/index.js";
import { installEditorStyles } from "./styles.js";

export interface RigAssetLoader {
  loadCharacter(file: File): Promise<unknown>;
}

export interface RigEditorOptions {
  rig?: Rig | RigDefinition | null;
  scene?: THREE.Scene;
  assetLoader?: RigAssetLoader;
  onSave?: (definition: RigDefinition) => void | Promise<void>;
  viewportFactory?: (container: HTMLElement, options: Parameters<typeof createRigViewport>[1]) => RigViewport;
}

export interface RigEditor {
  readonly element: HTMLElement;
  loadRig(definition: Rig | RigDefinition): void;
  loadCharacter(asset: unknown): void;
  serializeRig(): RigDefinition;
  dispose(): void;
}

export function createRigEditor(container: HTMLElement, options: RigEditorOptions = {}): RigEditor {
  installEditorStyles(container.ownerDocument);

  let rig = options.rig ? normalizeRig(options.rig) : null;
  let selectedControl = rig?.getControlDefinitions()[0]?.name ?? null;

  const root = el("div", "trig-editor");
  const toolbar = el("div", "trig-toolbar");
  const title = el("strong");
  title.textContent = "Three Control Rig";
  const saveButton = button("Save .trig");
  const importButton = button("Import GLB");
  toolbar.append(title, saveButton, importButton);

  const body = el("div", "trig-body");
  const graphPanel = panel("Rig Graph");
  const graphStage = el("div", "trig-graph-stage");
  graphPanel.append(graphStage);

  const viewportPanel = el("div", "trig-viewport");
  const inspector = panel("Controls");
  inspector.classList.add("trig-inspector");
  const controlList = el("div", "trig-control-list");
  const properties = el("div", "trig-properties");
  inspector.append(controlList, properties);
  body.append(graphPanel, viewportPanel, inspector);
  root.append(toolbar, body);
  container.replaceChildren(root);

  const viewport = (options.viewportFactory ?? createRigViewport)(viewportPanel, {
    rig,
    scene: options.scene,
    onControlChange: (name) => {
      selectedControl = name;
      renderInspector();
    },
  });

  saveButton.addEventListener("click", () => {
    if (!rig) {
      return;
    }
    void options.onSave?.(rig.toJSON());
  });

  importButton.disabled = !options.assetLoader;
  importButton.addEventListener("click", () => {
    if (!options.assetLoader) {
      return;
    }
    const input = container.ownerDocument.createElement("input");
    input.type = "file";
    input.accept = ".glb,.gltf,model/gltf-binary,model/gltf+json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      const asset = await options.assetLoader?.loadCharacter(file);
      if (asset) {
        api.loadCharacter(asset);
      }
    });
    input.click();
  });

  const api: RigEditor = {
    element: root,
    loadRig(definition) {
      rig = normalizeRig(definition);
      selectedControl = rig.getControlDefinitions()[0]?.name ?? null;
      viewport.setRig(rig);
      renderAll();
    },
    loadCharacter(asset) {
      const result = bindCharacterAsset(asset, rig);
      if (result.rig) {
        rig = result.rig;
      }
      viewport.setAdapter(result.binder, result.root);
      if (rig) {
        viewport.setRig(rig);
      }
      renderAll();
    },
    serializeRig() {
      if (!rig) {
        throw new Error("Cannot serialize an editor without a rig");
      }
      return rig.toJSON();
    },
    dispose() {
      viewport.dispose();
      root.remove();
    },
  };

  function renderAll(): void {
    renderGraph();
    renderInspector();
    viewport.syncFromRig();
  }

  function renderGraph(): void {
    graphStage.replaceChildren();
    if (!rig) {
      return;
    }

    const graph = rig.definition.graph;
    const svg = svgEl("svg");
    svg.setAttribute("class", "trig-graph-svg");

    for (const edge of graph.edges) {
      const source = graph.nodes.find((node) => node.id === edge.source);
      const target = graph.nodes.find((node) => node.id === edge.target);
      if (!source?.position || !target?.position) {
        continue;
      }
      const line = svgEl("line");
      line.setAttribute("x1", String(source.position[0] + 148));
      line.setAttribute("y1", String(source.position[1] + 24));
      line.setAttribute("x2", String(target.position[0]));
      line.setAttribute("y2", String(target.position[1] + 24));
      line.setAttribute("stroke", "rgba(125, 211, 252, 0.36)");
      line.setAttribute("stroke-width", "2");
      svg.append(line);
    }

    graphStage.append(svg);
    for (const node of graph.nodes) {
      const item = el("div", "trig-node");
      item.style.left = `${node.position?.[0] ?? 0}px`;
      item.style.top = `${node.position?.[1] ?? 0}px`;
      item.innerHTML = `<strong></strong><span></span>`;
      item.querySelector("strong")!.textContent = node.label ?? node.id;
      item.querySelector("span")!.textContent = node.type;
      item.addEventListener("pointerdown", (event) => startDragNode(event, item, node.id));
      graphStage.append(item);
    }
  }

  function startDragNode(event: PointerEvent, element: HTMLElement, nodeId: string): void {
    if (!rig) {
      return;
    }
    element.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const node = rig.definition.graph.nodes.find((item) => item.id === nodeId);
    const startPosition = node?.position ? [...node.position] : [0, 0, 0];

    const move = (moveEvent: PointerEvent) => {
      if (!node) {
        return;
      }
      node.position = [startPosition[0] + moveEvent.clientX - startX, startPosition[1] + moveEvent.clientY - startY, 0];
      element.style.left = `${node.position[0]}px`;
      element.style.top = `${node.position[1]}px`;
      renderGraph();
    };
    const end = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", end);
    };

    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  }

  function renderInspector(): void {
    controlList.replaceChildren();
    properties.replaceChildren();
    if (!rig) {
      return;
    }

    for (const control of rig.getControlDefinitions()) {
      const row = button(control.name, "trig-control-row");
      row.classList.toggle("is-selected", control.name === selectedControl);
      row.style.setProperty("--trig-control-color", control.color ?? "#7dd3fc");
      row.innerHTML = `<i class="trig-swatch"></i><span></span>`;
      row.querySelector("span")!.textContent = control.name;
      row.addEventListener("click", () => {
        selectedControl = control.name;
        viewport.selectControl(control.name);
        renderInspector();
      });
      controlList.append(row);
    }

    if (!selectedControl) {
      return;
    }

    const transform = rig.getControl(selectedControl);
    const fieldset = el("div", "trig-fieldset");
    (["x", "y", "z"] as const).forEach((axis, index) => {
      const field = el("div", "trig-field");
      const label = el("label");
      label.textContent = `Position ${axis}`;
      const input = container.ownerDocument.createElement("input");
      input.type = "number";
      input.step = "0.01";
      input.value = transform.position[index].toFixed(2);
      input.addEventListener("input", () => {
        if (!rig || !selectedControl) {
          return;
        }
        const next = rig.getControl(selectedControl).position;
        next[index] = Number(input.value);
        rig.setControl(selectedControl, { position: next });
        rig.evaluate(0);
        viewport.syncFromRig();
      });
      field.append(label, input);
      fieldset.append(field);
    });
    properties.append(fieldset);
  }

  renderAll();
  if (selectedControl) {
    viewport.selectControl(selectedControl);
  }

  return api;
}

function normalizeRig(value: Rig | RigDefinition): Rig {
  return value instanceof Rig ? value : Rig.fromJSON(value);
}

function bindCharacterAsset(asset: unknown, currentRig: Rig | null): { root: THREE.Object3D | null; binder: ThreeSkeletonBinder | null; rig: Rig | null } {
  if (isDemoCharacter(asset)) {
    return { root: asset.root, binder: asset.binder, rig: currentRig ?? asset.rig };
  }

  const root = extractObject3D(asset);
  if (!root) {
    return { root: null, binder: null, rig: currentRig };
  }

  let skinnedMesh: THREE.SkinnedMesh | null = null;
  root.traverse((object) => {
    if (!skinnedMesh && (object as THREE.SkinnedMesh).isSkinnedMesh) {
      skinnedMesh = object as THREE.SkinnedMesh;
    }
  });

  const binder = skinnedMesh ? ThreeSkeletonBinder.fromSkinnedMesh(skinnedMesh) : null;
  if (binder && currentRig) {
    currentRig.bind(binder);
    currentRig.evaluate(0);
  }
  return { root, binder, rig: currentRig };
}

function isDemoCharacter(asset: unknown): asset is { root: THREE.Object3D; binder: ThreeSkeletonBinder; rig: Rig } {
  return Boolean(
    asset &&
      typeof asset === "object" &&
      "root" in asset &&
      "binder" in asset &&
      "rig" in asset,
  );
}

function extractObject3D(asset: unknown): THREE.Object3D | null {
  if (asset instanceof THREE.Object3D) {
    return asset;
  }
  if (asset && typeof asset === "object" && "scene" in asset && asset.scene instanceof THREE.Object3D) {
    return asset.scene;
  }
  return null;
}

function panel(title: string): HTMLElement {
  const root = el("section", "trig-panel");
  const header = el("div", "trig-panel-header");
  header.textContent = title;
  root.append(header);
  return root;
}

function button(label: string, className?: string): HTMLButtonElement {
  const item = document.createElement("button");
  item.type = "button";
  item.className = className ?? "";
  item.textContent = label;
  return item;
}

function el(tag: string, className?: string): HTMLElement {
  const item = document.createElement(tag);
  if (className) {
    item.className = className;
  }
  return item;
}

function svgEl(tag: string): SVGElement {
  return document.createElementNS("http://www.w3.org/2000/svg", tag);
}
