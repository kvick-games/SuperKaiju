import * as THREE from "three";
import { Rig, createDemoHumanoidRigDefinition } from "../core/index.js";
import { ThreeSkeletonBinder } from "./ThreeSkeletonBinder.js";

export interface DemoCharacter {
  root: THREE.Group;
  bones: THREE.Bone[];
  binder: ThreeSkeletonBinder;
  rig: Rig;
}

export function createDemoCharacter(): DemoCharacter {
  const root = new THREE.Group();
  root.name = "Generated Humanoid Character";

  const hips = bone("Hips", [0, 1.05, 0]);
  const spine = bone("Spine", [0, 0.28, 0]);
  const chest = bone("Chest", [0, 0.32, 0]);
  const neck = bone("Neck", [0, 0.22, 0]);
  const head = bone("Head", [0, 0.22, 0]);

  const upperArmL = bone("UpperArm.L", [-0.36, 0.14, 0]);
  const lowerArmL = bone("LowerArm.L", [-0.44, -0.08, 0]);
  const handL = bone("Hand.L", [-0.36, -0.04, 0]);

  const upperArmR = bone("UpperArm.R", [0.36, 0.14, 0]);
  const lowerArmR = bone("LowerArm.R", [0.44, -0.08, 0]);
  const handR = bone("Hand.R", [0.36, -0.04, 0]);

  const upperLegL = bone("UpperLeg.L", [-0.2, -0.18, 0]);
  const lowerLegL = bone("LowerLeg.L", [0, -0.52, 0]);
  const footL = bone("Foot.L", [0, -0.46, 0.16]);

  const upperLegR = bone("UpperLeg.R", [0.2, -0.18, 0]);
  const lowerLegR = bone("LowerLeg.R", [0, -0.52, 0]);
  const footR = bone("Foot.R", [0, -0.46, 0.16]);

  root.add(hips);
  hips.add(spine, upperLegL, upperLegR);
  spine.add(chest);
  chest.add(neck, upperArmL, upperArmR);
  neck.add(head);
  upperArmL.add(lowerArmL);
  lowerArmL.add(handL);
  upperArmR.add(lowerArmR);
  lowerArmR.add(handR);
  upperLegL.add(lowerLegL);
  lowerLegL.add(footL);
  upperLegR.add(lowerLegR);
  lowerLegR.add(footR);

  const bones = [
    hips,
    spine,
    chest,
    neck,
    head,
    upperArmL,
    lowerArmL,
    handL,
    upperArmR,
    lowerArmR,
    handR,
    upperLegL,
    lowerLegL,
    footL,
    upperLegR,
    lowerLegR,
    footR,
  ];
  root.updateMatrixWorld(true);

  const binder = ThreeSkeletonBinder.fromBones(bones, root);
  const rig = Rig.fromJSON(createDemoHumanoidRigDefinition()).bind(binder);
  rig.evaluate(0);

  return { root, bones, binder, rig };
}

function bone(name: string, position: [number, number, number]): THREE.Bone {
  const item = new THREE.Bone();
  item.name = name;
  item.position.fromArray(position);
  return item;
}
