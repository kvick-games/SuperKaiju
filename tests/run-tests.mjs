import assert from "node:assert/strict";
import {
  Rig,
  createDemoHumanoidRigDefinition,
  getConstraintExecutionOrder,
} from "../dist/lib/core/index.js";
import { createDemoCharacter } from "../dist/lib/three/index.js";
import { createRigEditor } from "../dist/lib/editor/index.js";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createMockAdapter(restPose) {
  const rest = new Map(Object.entries(restPose).map(([name, transform]) => [name, cloneTransform(transform)]));
  const current = new Map(Object.entries(restPose).map(([name, transform]) => [name, cloneTransform(transform)]));
  return {
    getBoneNames: () => [...current.keys()],
    getBoneParent: () => null,
    getBoneLocalTransform: (name) => cloneTransform(current.get(name)),
    setBoneLocalTransform: (name, transform) => current.set(name, cloneTransform(transform)),
    getBoneWorldTransform: (name) => cloneTransform(current.get(name)),
    setBoneWorldTransform: (name, transform) => current.set(name, cloneTransform(transform)),
    setBoneWorldPosition: (name, position) => {
      const transform = cloneTransform(current.get(name));
      transform.position = [...position];
      current.set(name, transform);
    },
    resetPose: () => {
      for (const [name, transform] of rest) {
        current.set(name, cloneTransform(transform));
      }
    },
    updateWorldMatrices: () => {},
    lookAtBone: () => {},
    peek: (name) => cloneTransform(current.get(name)),
  };
}

function transform(position = [0, 0, 0], rotation = [0, 0, 0, 1], scale = [1, 1, 1]) {
  return { position, rotation, scale };
}

function cloneTransform(value) {
  return {
    position: [...value.position],
    rotation: [...value.rotation],
    scale: [...value.scale],
  };
}

function baseDefinition(overrides = {}) {
  return {
    schemaVersion: "1.0",
    skeletonRef: { kind: "generated", rootBone: "Root" },
    controls: [],
    spaces: [],
    graph: { nodes: [], edges: [] },
    constraints: [],
    ...overrides,
  };
}

function near(a, b, tolerance = 1e-4) {
  assert.equal(a.length, b.length);
  for (let index = 0; index < a.length; index += 1) {
    assert.ok(Math.abs(a[index] - b[index]) <= tolerance, `${a[index]} is not near ${b[index]}`);
  }
}

test("orders constraint graph nodes topologically", () => {
  const definition = baseDefinition({
    graph: {
      nodes: [
        { id: "a", type: "constraint", constraintId: "c-a" },
        { id: "b", type: "constraint", constraintId: "c-b" },
      ],
      edges: [{ id: "a-b", source: "a", target: "b" }],
    },
    constraints: [
      { id: "c-b", type: "position", bone: "B", source: { type: "control", name: "target" } },
      { id: "c-a", type: "position", bone: "A", source: { type: "control", name: "target" } },
    ],
  });
  assert.deepEqual(getConstraintExecutionOrder(definition).map((constraint) => constraint.id), ["c-a", "c-b"]);
});

test("round-trips current control values through rig JSON", () => {
  const rig = Rig.fromJSON(
    baseDefinition({
      controls: [{ name: "target", initial: { position: [0, 0, 0] } }],
    }),
  );
  rig.setControl("target", { position: [1, 2, 3] });
  assert.deepEqual(rig.toJSON().controls[0].initial.position, [1, 2, 3]);
});

test("applies FK controls to local bone transforms", () => {
  const adapter = createMockAdapter({ Arm: transform() });
  const rig = Rig.fromJSON(
    baseDefinition({
      controls: [{ name: "armFK", initial: { position: [1, 2, 3] } }],
      constraints: [{ id: "fk", type: "fkChain", bones: ["Arm"], controls: ["armFK"] }],
    }),
  ).bind(adapter);
  rig.evaluate(0);
  near(adapter.peek("Arm").position, [1, 2, 3]);
});

test("clamps controls before applying position constraints", () => {
  const adapter = createMockAdapter({ Root: transform() });
  const rig = Rig.fromJSON(
    baseDefinition({
      controls: [
        {
          name: "rootControl",
          initial: { position: [0, 0, 0] },
          limits: { position: { min: [-1, -1, -1], max: [1, 1, 1] } },
        },
      ],
      constraints: [{ id: "copy-position", type: "position", bone: "Root", source: { type: "control", name: "rootControl" } }],
    }),
  ).bind(adapter);
  rig.setControl("rootControl", { position: [4, 2, -3] });
  rig.evaluate(0);
  near(adapter.peek("Root").position, [1, 1, -1]);
});

test("solves a two-bone IK end effector toward its target", () => {
  const adapter = createMockAdapter({
    Upper: transform([0, 0, 0]),
    Lower: transform([0, 1, 0]),
    Hand: transform([0, 2, 0]),
  });
  const rig = Rig.fromJSON(
    baseDefinition({
      controls: [
        { name: "handIK", initial: { position: [1, 1, 0] } },
        { name: "pole", initial: { position: [0, 0, 1] } },
      ],
      constraints: [
        {
          id: "arm-ik",
          type: "twoBoneIK",
          rootBone: "Upper",
          midBone: "Lower",
          endBone: "Hand",
          targetControl: "handIK",
          poleControl: "pole",
        },
      ],
    }),
  ).bind(adapter);
  rig.evaluate(0);
  near(adapter.peek("Hand").position, [1, 1, 0]);
});

test("binds and evaluates a generated Three.js demo skeleton", () => {
  const demo = createDemoCharacter();
  demo.rig.setControl("leftHandIK", { position: [-1.35, 1.55, 0.2] });
  const result = demo.rig.evaluate(1 / 60);
  assert.ok(result.appliedConstraints.includes("left-arm-ik"));
  const hand = demo.binder.getBoneWorldTransform("Hand.L");
  assert.ok(Number.isFinite(hand.position[0]));
  assert.ok(hand.position[0] < -0.6);
});

test("mounts the editor with host-provided viewport callbacks", () => {
  const documentRef = createFakeDocument();
  globalThis.document = documentRef;
  const container = documentRef.createElement("div");
  container.ownerDocument = documentRef;

  let saved = null;
  const editor = createRigEditor(container, {
    rig: createDemoHumanoidRigDefinition(),
    onSave(definition) {
      saved = definition;
    },
    viewportFactory: () => ({
      element: documentRef.createElement("canvas"),
      scene: {},
      camera: {},
      renderer: {},
      setRig: () => {},
      setAdapter: () => {},
      selectControl: () => {},
      syncFromRig: () => {},
      render: () => {},
      resize: () => {},
      dispose: () => {},
    }),
  });

  assert.equal(editor.serializeRig().schemaVersion, "1.0");
  editor.loadRig(createDemoHumanoidRigDefinition());
  editor.element.querySelector = () => null;
  saved = editor.serializeRig();
  assert.equal(saved.skeletonRef.kind, "generated");
  editor.dispose();
});

function createFakeDocument() {
  const documentRef = {
    head: createFakeElement("head"),
    getElementById: () => null,
    createElement(tag) {
      const element = createFakeElement(tag);
      element.ownerDocument = documentRef;
      return element;
    },
    createElementNS(_namespace, tag) {
      const element = createFakeElement(tag);
      element.ownerDocument = documentRef;
      return element;
    },
  };
  return documentRef;
}

function createFakeElement(tag) {
  const listeners = new Map();
  const element = {
    tagName: tag.toUpperCase(),
    children: [],
    ownerDocument: null,
    style: {
      setProperty(name, value) {
        this[name] = value;
      },
    },
    className: "",
    textContent: "",
    innerHTML: "",
    type: "",
    accept: "",
    disabled: false,
    files: [],
    classList: {
      add: () => {},
      toggle: () => {},
    },
    append(...items) {
      this.children.push(...items);
    },
    appendChild(item) {
      this.children.push(item);
      return item;
    },
    replaceChildren(...items) {
      this.children = [...items];
    },
    remove() {
      this.removed = true;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    setPointerCapture: () => {},
    click() {
      listeners.get("click")?.({ type: "click" });
    },
    querySelector() {
      const child = createFakeElement("span");
      child.ownerDocument = this.ownerDocument;
      return child;
    },
    setAttribute(name, value) {
      this[name] = value;
    },
  };
  return element;
}

for (const { name, fn } of tests) {
  await fn();
  console.log(`ok - ${name}`);
}

console.log(`${tests.length} tests passed`);
