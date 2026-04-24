import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { Rig, RigSkeletonAdapter, Transform } from "../core/index.js";

export interface RigViewportOptions {
  rig?: Rig | null;
  adapter?: RigSkeletonAdapter | null;
  character?: THREE.Object3D | null;
  scene?: THREE.Scene;
  onControlChange?: (controlName: string, transform: Transform) => void;
}

export interface RigViewport {
  element: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  setRig(rig: Rig | null): void;
  setAdapter(adapter: RigSkeletonAdapter | null, character?: THREE.Object3D | null): void;
  selectControl(name: string | null): void;
  syncFromRig(): void;
  render(): void;
  resize(): void;
  dispose(): void;
}

interface ControlObject extends THREE.Mesh {
  userData: {
    controlName: string;
  };
}

export function createRigViewport(container: HTMLElement, options: RigViewportOptions = {}): RigViewport {
  let rig = options.rig ?? null;
  let adapter = options.adapter ?? rig?.getAdapter() ?? null;
  let character: THREE.Object3D | null = options.character ?? null;
  let selectedControl: string | null = null;

  const scene = options.scene ?? new THREE.Scene();
  scene.background = new THREE.Color(0x10141b);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  camera.position.set(3, 2.2, 4.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth || 640, container.clientHeight || 480);
  renderer.domElement.className = "trig-viewport-canvas";
  container.append(renderer.domElement);

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.target.set(0, 1.15, 0);

  const transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.setMode("translate");
  scene.add(transformControls);

  const controlGroup = new THREE.Group();
  controlGroup.name = "Rig Controls";
  scene.add(controlGroup);

  const helperGroup = new THREE.Group();
  helperGroup.name = "Rig Helpers";
  scene.add(helperGroup);

  const controlObjects = new Map<string, ControlObject>();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const grid = new THREE.GridHelper(4, 16, 0x334155, 0x1f2937);
  scene.add(grid);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x263241, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(3, 4, 2);
  scene.add(key);

  if (character) {
    scene.add(character);
    helperGroup.add(new THREE.SkeletonHelper(character));
  }

  transformControls.addEventListener("dragging-changed", (event) => {
    orbit.enabled = !(event as unknown as { value: boolean }).value;
  });

  transformControls.addEventListener("objectChange", () => {
    if (!rig || !selectedControl) {
      return;
    }
    const object = controlObjects.get(selectedControl);
    if (!object) {
      return;
    }

    rig.setControl(selectedControl, { position: [object.position.x, object.position.y, object.position.z] });
    rig.evaluate(0);
    options.onControlChange?.(selectedControl, rig.getControl(selectedControl));
  });

  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (!rig || controlObjects.size === 0) {
      return;
    }

    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([...controlObjects.values()], false);
    if (hits[0]?.object) {
      selectControl((hits[0].object as ControlObject).userData.controlName);
    }
  });

  function setRig(nextRig: Rig | null): void {
    rig = nextRig;
    adapter = nextRig?.getAdapter() ?? adapter;
    rebuildControls();
    syncFromRig();
  }

  function setAdapter(nextAdapter: RigSkeletonAdapter | null, nextCharacter?: THREE.Object3D | null): void {
    adapter = nextAdapter;
    if (rig && nextAdapter) {
      rig.bind(nextAdapter);
      rig.evaluate(0);
    }

    if (nextCharacter !== undefined) {
      if (character) {
        scene.remove(character);
      }
      character = nextCharacter;
      helperGroup.clear();
      if (character) {
        scene.add(character);
        helperGroup.add(new THREE.SkeletonHelper(character));
      }
    }
    syncFromRig();
  }

  function rebuildControls(): void {
    controlGroup.clear();
    controlObjects.clear();
    transformControls.detach();

    if (!rig) {
      return;
    }

    for (const control of rig.getControlDefinitions()) {
      const object = createControlObject(control.shape ?? "sphere", control.color ?? "#7dd3fc");
      object.name = `Control ${control.name}`;
      object.userData.controlName = control.name;
      controlGroup.add(object);
      controlObjects.set(control.name, object);
    }
  }

  function selectControl(name: string | null): void {
    selectedControl = name;
    for (const [controlName, object] of controlObjects) {
      const material = object.material as THREE.MeshStandardMaterial;
      material.emissive.set(controlName === name ? 0x334155 : 0x000000);
      material.emissiveIntensity = controlName === name ? 0.8 : 0;
    }

    const object = name ? controlObjects.get(name) : undefined;
    if (object) {
      transformControls.attach(object);
    } else {
      transformControls.detach();
    }
  }

  function syncFromRig(): void {
    if (!rig) {
      return;
    }

    for (const [name, object] of controlObjects) {
      const transform = rig.getControlWorldTransform(name);
      object.position.fromArray(transform.position);
      object.quaternion.fromArray(transform.rotation);
      object.scale.fromArray(transform.scale);
    }
  }

  function resize(): void {
    const width = container.clientWidth || 640;
    const height = container.clientHeight || 480;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function render(): void {
    orbit.update();
    renderer.render(scene, camera);
  }

  function dispose(): void {
    renderer.setAnimationLoop(null);
    transformControls.dispose();
    orbit.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  renderer.setAnimationLoop(() => {
    syncFromRig();
    render();
  });

  rebuildControls();
  syncFromRig();
  resize();

  return {
    element: renderer.domElement,
    scene,
    camera,
    renderer,
    setRig,
    setAdapter,
    selectControl,
    syncFromRig,
    render,
    resize,
    dispose: () => {
      resizeObserver.disconnect();
      dispose();
    },
  };
}

export function attachRigToScene(rig: Rig, scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group();
  group.name = "Attached Rig Controls";
  for (const control of rig.getControlDefinitions()) {
    const object = createControlObject(control.shape ?? "sphere", control.color ?? "#7dd3fc");
    object.name = `Control ${control.name}`;
    object.position.fromArray(rig.getControlWorldTransform(control.name).position);
    group.add(object);
  }
  scene.add(group);
  return group;
}

function createControlObject(shape: string, color: string): ControlObject {
  const geometry =
    shape === "cube"
      ? new THREE.BoxGeometry(0.16, 0.16, 0.16)
      : shape === "locator"
        ? new THREE.OctahedronGeometry(0.12)
        : new THREE.SphereGeometry(0.1, 20, 12);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.38,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, material) as unknown as ControlObject;
  mesh.userData.controlName = "";
  return mesh;
}
