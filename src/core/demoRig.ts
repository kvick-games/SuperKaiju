import type { RigDefinition } from "./types.js";

export function createDemoHumanoidRigDefinition(): RigDefinition {
  return {
    schemaVersion: "1.0",
    skeletonRef: {
      kind: "generated",
      rootBone: "Hips",
    },
    controls: [
      {
        name: "hips",
        targetBone: "Hips",
        shape: "cube",
        color: "#f2c14e",
        initial: { position: [0, 1.05, 0], scale: [1, 1, 1] },
        limits: {
          position: { min: [-1.5, 0.5, -1.5], max: [1.5, 1.8, 1.5] },
        },
      },
      {
        name: "headLook",
        targetBone: "Head",
        shape: "sphere",
        color: "#4cc9f0",
        initial: { position: [0, 2.45, 1.25] },
      },
      {
        name: "leftHandIK",
        targetBone: "Hand.L",
        shape: "sphere",
        color: "#ff8fab",
        initial: { position: [-1.1, 1.45, 0.3] },
      },
      {
        name: "leftElbowPole",
        shape: "locator",
        color: "#f72585",
        initial: { position: [-1.2, 1.2, -0.95] },
      },
      {
        name: "rightHandIK",
        targetBone: "Hand.R",
        shape: "sphere",
        color: "#90be6d",
        initial: { position: [1.1, 1.45, 0.3] },
      },
      {
        name: "rightElbowPole",
        shape: "locator",
        color: "#43aa8b",
        initial: { position: [1.2, 1.2, -0.95] },
      },
    ],
    spaces: [
      {
        name: "world",
        parent: { type: "world" },
      },
    ],
    graph: {
      nodes: [
        { id: "node-hips", type: "control", label: "Hips", controlName: "hips", position: [40, 80, 0] },
        { id: "node-parent-hips", type: "constraint", label: "Parent Hips", constraintId: "parent-hips", position: [280, 80, 0] },
        { id: "node-left-ik", type: "constraint", label: "Left Arm IK", constraintId: "left-arm-ik", position: [280, 200, 0] },
        { id: "node-right-ik", type: "constraint", label: "Right Arm IK", constraintId: "right-arm-ik", position: [280, 320, 0] },
        { id: "node-head-aim", type: "constraint", label: "Head Aim", constraintId: "head-aim", position: [280, 440, 0] },
      ],
      edges: [
        { id: "edge-hips", source: "node-hips", target: "node-parent-hips" },
        { id: "edge-hips-left", source: "node-parent-hips", target: "node-left-ik" },
        { id: "edge-left-right", source: "node-left-ik", target: "node-right-ik" },
        { id: "edge-right-head", source: "node-right-ik", target: "node-head-aim" },
      ],
    },
    constraints: [
      {
        id: "parent-hips",
        type: "position",
        bone: "Hips",
        source: { type: "control", name: "hips" },
      },
      {
        id: "left-arm-ik",
        type: "twoBoneIK",
        rootBone: "UpperArm.L",
        midBone: "LowerArm.L",
        endBone: "Hand.L",
        targetControl: "leftHandIK",
        poleControl: "leftElbowPole",
      },
      {
        id: "right-arm-ik",
        type: "twoBoneIK",
        rootBone: "UpperArm.R",
        midBone: "LowerArm.R",
        endBone: "Hand.R",
        targetControl: "rightHandIK",
        poleControl: "rightElbowPole",
      },
      {
        id: "head-aim",
        type: "aim",
        bone: "Head",
        target: { type: "control", name: "headLook" },
      },
    ],
    metadata: {
      name: "Generated Humanoid Control Rig",
      authoringMode: "pose-live-solve",
    },
  };
}
