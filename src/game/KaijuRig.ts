import * as THREE from "three";
import { Rig, type RigDefinition, type Vec3Tuple } from "../core/index.js";
import { createRagdollSkeleton, ThreeSkeletonBinder, type RagdollSkeleton } from "../three/index.js";

export type KaijuAttackKind = "stomp" | "swipe" | "bite";
export type KaijuBodyPlan = "lizard" | "blue-wolf" | "brown-gorilla";

export interface KaijuRigProfile {
  displayName: string;
  bodyPlan: KaijuBodyPlan;
  bellyColor: number;
  hornColor: number;
  clawColor: number;
  healthColor: number;
  bodyScale: Vec3Tuple;
}

export interface KaijuPoseState {
  time: number;
  movingAmount: number;
  freeze: number;
  attackKind: KaijuAttackKind | null;
  attackProgress: number;
}

export interface KaijuRigInstance {
  readonly root: THREE.Group;
  readonly rig: Rig;
  readonly binder: ThreeSkeletonBinder;
  readonly healthFill: THREE.Mesh;
  updatePose(state: KaijuPoseState): void;
  startRagdoll(impulse?: THREE.Vector3): void;
  startStunnedRagdoll(impulse?: THREE.Vector3): void;
  translateRagdoll(offset: THREE.Vector3): void;
  updateRagdoll(delta: number): void;
  getRagdollRootPosition(target?: THREE.Vector3): THREE.Vector3;
  syncRagdollPose(): void;
  isRagdollActive(): boolean;
  resetPose(): void;
}

const WORLD = new THREE.Vector3();
const LOCAL = new THREE.Vector3();
const AXIS_Y = new THREE.Vector3(0, 1, 0);

const DEFAULT_KAIJU_RIG_PROFILE: KaijuRigProfile = {
  displayName: "Kaiju",
  bodyPlan: "lizard",
  bellyColor: 0x6b7b54,
  hornColor: 0xe5d4a3,
  clawColor: 0x2a2f2e,
  healthColor: 0xd75d4b,
  bodyScale: [1, 1, 1],
};

export function createKaijuRig(
  id: number,
  bodyMaterial: THREE.MeshStandardMaterial,
  profile: KaijuRigProfile = DEFAULT_KAIJU_RIG_PROFILE,
): KaijuRigInstance {
  const root = new THREE.Group();
  root.name = `${profile.displayName} ${id} control rig`;

  const hornMaterial = new THREE.MeshStandardMaterial({ color: profile.hornColor, roughness: 0.7 });
  const clawMaterial = new THREE.MeshStandardMaterial({ color: profile.clawColor, roughness: 0.78 });
  const bellyMaterial = new THREE.MeshStandardMaterial({ color: profile.bellyColor, roughness: 0.86 });

  const hips = bone("Hips", [0, 7.8, 0]);
  const spine = bone("Spine", [0, 7.2, 0]);
  const chest = bone("Chest", [0, 7.4, -0.3]);
  const neck = bone("Neck", [0, 5.6, -0.6]);
  const head = bone("Head", [0, 3.7, -0.7]);
  const upperArmL = bone("UpperArm.L", [-8.3, 2.8, -0.4]);
  const lowerArmL = bone("LowerArm.L", [-5.2, -5.8, -0.4]);
  const handL = bone("Hand.L", [-2.8, -5.4, -0.2]);
  const upperArmR = bone("UpperArm.R", [8.3, 2.8, -0.4]);
  const lowerArmR = bone("LowerArm.R", [5.2, -5.8, -0.4]);
  const handR = bone("Hand.R", [2.8, -5.4, -0.2]);
  const upperLegL = bone("UpperLeg.L", [-4.2, -1.4, 1.2]);
  const lowerLegL = bone("LowerLeg.L", [0.1, -6.3, 0.5]);
  const footL = bone("Foot.L", [0.15, -4.6, -2.1]);
  const upperLegR = bone("UpperLeg.R", [4.2, -1.4, 1.2]);
  const lowerLegR = bone("LowerLeg.R", [-0.1, -6.3, 0.5]);
  const footR = bone("Foot.R", [-0.15, -4.6, -2.1]);

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

  attachTorsoMeshes(
    id,
    profile,
    bodyMaterial,
    bellyMaterial,
    hornMaterial,
    clawMaterial,
    {
      Hips: hips,
      Spine: spine,
      Chest: chest,
      Head: head,
      "UpperArm.L": upperArmL,
      "LowerArm.L": lowerArmL,
      "Hand.L": handL,
      "UpperArm.R": upperArmR,
      "LowerArm.R": lowerArmR,
      "Hand.R": handR,
      "UpperLeg.L": upperLegL,
      "LowerLeg.L": lowerLegL,
      "Foot.L": footL,
      "UpperLeg.R": upperLegR,
      "LowerLeg.R": lowerLegR,
      "Foot.R": footR,
    },
  );

  const healthGroup = new THREE.Group();
  healthGroup.position.set(0, 40.5, 0);
  const healthBack = new THREE.Mesh(
    new THREE.BoxGeometry(15, 1.1, 0.5),
    new THREE.MeshBasicMaterial({ color: 0x191e22 }),
  );
  const healthFill = new THREE.Mesh(
    new THREE.BoxGeometry(14.2, 0.62, 0.62),
    new THREE.MeshBasicMaterial({ color: profile.healthColor }),
  );
  healthGroup.add(healthBack, healthFill);
  root.add(healthGroup);

  root.updateMatrixWorld(true);
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
  const binder = ThreeSkeletonBinder.fromBones(bones, root);
  const rig = Rig.fromJSON(createKaijuRigDefinition(id)).bind(binder);

  return new KaijuRig(root, rig, binder, healthFill);
}

class KaijuRig implements KaijuRigInstance {
  private readonly ragdoll: RagdollSkeleton;

  constructor(
    readonly root: THREE.Group,
    readonly rig: Rig,
    readonly binder: ThreeSkeletonBinder,
    readonly healthFill: THREE.Mesh,
  ) {
    this.ragdoll = createRagdollSkeleton(binder, {
      floorY: 0,
      damping: 0.958,
      solverIterations: 9,
      stiffness: 0.94,
      particleRadius: 1.15,
    });
  }

  resetPose(): void {
    this.ragdoll.setEnabled(false);
    this.healthFill.parent!.visible = true;
    this.binder.resetPose();
    this.updatePose({ time: 0, movingAmount: 0, freeze: 0, attackKind: null, attackProgress: 1 });
  }

  updatePose(state: KaijuPoseState): void {
    if (this.ragdoll.isEnabled()) {
      return;
    }

    const motion = Math.max(0, 1 - state.freeze);
    const walk = Math.sin(state.time * (4.4 - state.freeze * 2.2)) * state.movingAmount * motion;
    const gait = Math.cos(state.time * (4.4 - state.freeze * 2.2)) * state.movingAmount * motion;
    const idleBreath = Math.sin(state.time * 1.7) * 0.05 * motion;
    const freezeTension = state.freeze * 0.18;

    const pose = {
      hipsY: 7.8 + Math.abs(gait) * 0.55 * motion,
      hipsRoll: Math.sin(state.time * 2.7) * 0.035 * motion,
      spinePitch: -0.04 + idleBreath - freezeTension,
      chestPitch: 0.07 + idleBreath * 1.4,
      chestRoll: -walk * 0.035,
      headPitch: 0.04 - idleBreath,
      leftUpperLegPitch: -walk * 0.24,
      leftLowerLegPitch: Math.max(0, walk) * 0.2,
      rightUpperLegPitch: walk * 0.24,
      rightLowerLegPitch: Math.max(0, -walk) * 0.2,
      leftHand: new THREE.Vector3(-14.2, 18.2 + walk * 1.3, -1.8 - gait * 0.8),
      rightHand: new THREE.Vector3(14.2, 18.2 - walk * 1.3, -1.8 + gait * 0.8),
      leftPole: new THREE.Vector3(-12.8, 21, 8),
      rightPole: new THREE.Vector3(12.8, 21, 8),
      headAim: new THREE.Vector3(0, 32, -18),
    };

    applyAttackPose(pose, state.attackKind, state.attackProgress, motion);

    this.rig.setControl("Hips", {
      position: [0, pose.hipsY, 0],
      euler: [0, 0, pose.hipsRoll],
    });
    this.rig.setControl("Spine", { euler: [pose.spinePitch, 0, 0] });
    this.rig.setControl("Chest", { euler: [pose.chestPitch, 0, pose.chestRoll] });
    this.rig.setControl("Head", { euler: [pose.headPitch, 0, 0] });
    this.rig.setControl("UpperLeg.L", { euler: [pose.leftUpperLegPitch, 0, 0] });
    this.rig.setControl("LowerLeg.L", { euler: [pose.leftLowerLegPitch, 0, 0] });
    this.rig.setControl("UpperLeg.R", { euler: [pose.rightUpperLegPitch, 0, 0] });
    this.rig.setControl("LowerLeg.R", { euler: [pose.rightLowerLegPitch, 0, 0] });
    this.rig.setControl("leftHandIK", { position: this.toWorldTuple(pose.leftHand) });
    this.rig.setControl("rightHandIK", { position: this.toWorldTuple(pose.rightHand) });
    this.rig.setControl("leftElbowPole", { position: this.toWorldTuple(pose.leftPole) });
    this.rig.setControl("rightElbowPole", { position: this.toWorldTuple(pose.rightPole) });
    this.rig.setControl("headAim", { position: this.toWorldTuple(pose.headAim) });
    this.rig.evaluate(0);
  }

  startRagdoll(impulse = new THREE.Vector3()): void {
    this.healthFill.parent!.visible = false;
    this.activateRagdoll(impulse);
  }

  startStunnedRagdoll(impulse = new THREE.Vector3()): void {
    this.healthFill.parent!.visible = true;
    this.activateRagdoll(impulse);
  }

  translateRagdoll(offset: THREE.Vector3): void {
    if (!this.ragdoll.isEnabled() || offset.lengthSq() <= 0) {
      return;
    }

    this.ragdoll.translate([offset.x, offset.y, offset.z]);
  }

  private activateRagdoll(impulse: THREE.Vector3): void {
    this.ragdoll.setEnabled(true);
    const scaledImpulse = impulse.clone();
    if (scaledImpulse.lengthSq() < 0.001) {
      scaledImpulse.set(0, 20, -18);
    }
    scaledImpulse.multiplyScalar(0.018);
    this.ragdoll.applyImpulse({
      vector: [scaledImpulse.x, scaledImpulse.y + 0.8, scaledImpulse.z],
      strength: 1,
    });
    this.ragdoll.applyImpulse({
      boneNames: ["Head", "Hand.L", "Hand.R", "Foot.L", "Foot.R"],
      position: this.root.getWorldPosition(new THREE.Vector3()).toArray() as Vec3Tuple,
      radius: 36,
      strength: 5.2,
    });
  }

  updateRagdoll(delta: number): void {
    this.ragdoll.update(delta);
  }

  getRagdollRootPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.ragdoll.getParticlePosition("Hips", target);
  }

  syncRagdollPose(): void {
    this.ragdoll.syncPose();
  }

  isRagdollActive(): boolean {
    return this.ragdoll.isEnabled();
  }

  private toWorldTuple(local: THREE.Vector3): Vec3Tuple {
    WORLD.copy(local);
    this.root.localToWorld(WORLD);
    return [WORLD.x, WORLD.y, WORLD.z];
  }
}

function createKaijuRigDefinition(id: number): RigDefinition {
  const fkBones = ["Hips", "Spine", "Chest", "Head", "UpperLeg.L", "LowerLeg.L", "UpperLeg.R", "LowerLeg.R"];

  return {
    schemaVersion: "1.0",
    skeletonRef: {
      kind: "generated",
      rootBone: "Hips",
    },
    controls: [
      { name: "Hips", targetBone: "Hips", initial: { position: [0, 7.8, 0] } },
      { name: "Spine", targetBone: "Spine", initial: { position: [0, 7.2, 0] } },
      { name: "Chest", targetBone: "Chest", initial: { position: [0, 7.4, -0.3] } },
      { name: "Head", targetBone: "Head", initial: { position: [0, 3.7, -0.7] } },
      { name: "UpperLeg.L", targetBone: "UpperLeg.L", initial: { position: [-4.2, -1.4, 1.2] } },
      { name: "LowerLeg.L", targetBone: "LowerLeg.L", initial: { position: [0.1, -6.3, 0.5] } },
      { name: "UpperLeg.R", targetBone: "UpperLeg.R", initial: { position: [4.2, -1.4, 1.2] } },
      { name: "LowerLeg.R", targetBone: "LowerLeg.R", initial: { position: [-0.1, -6.3, 0.5] } },
      { name: "leftHandIK", targetBone: "Hand.L", shape: "sphere", color: "#ff8fab", initial: { position: [-14.2, 18.2, -1.8] } },
      { name: "leftElbowPole", shape: "locator", color: "#f72585", initial: { position: [-12.8, 21, 8] } },
      { name: "rightHandIK", targetBone: "Hand.R", shape: "sphere", color: "#90be6d", initial: { position: [14.2, 18.2, -1.8] } },
      { name: "rightElbowPole", shape: "locator", color: "#43aa8b", initial: { position: [12.8, 21, 8] } },
      { name: "headAim", targetBone: "Head", shape: "sphere", color: "#4cc9f0", initial: { position: [0, 32, -18] } },
    ],
    spaces: [{ name: "world", parent: { type: "world" } }],
    graph: {
      nodes: [
        { id: `kaiju-${id}-fk`, type: "constraint", label: "Body FK", constraintId: "body-fk", position: [40, 80, 0] },
        { id: `kaiju-${id}-left-ik`, type: "constraint", label: "Left Arm IK", constraintId: "left-arm-ik", position: [260, 80, 0] },
        { id: `kaiju-${id}-right-ik`, type: "constraint", label: "Right Arm IK", constraintId: "right-arm-ik", position: [260, 190, 0] },
        { id: `kaiju-${id}-head`, type: "constraint", label: "Head Aim", constraintId: "head-aim", position: [480, 130, 0] },
      ],
      edges: [
        { id: `kaiju-${id}-fk-left`, source: `kaiju-${id}-fk`, target: `kaiju-${id}-left-ik` },
        { id: `kaiju-${id}-left-right`, source: `kaiju-${id}-left-ik`, target: `kaiju-${id}-right-ik` },
        { id: `kaiju-${id}-right-head`, source: `kaiju-${id}-right-ik`, target: `kaiju-${id}-head` },
      ],
    },
    constraints: [
      {
        id: "body-fk",
        type: "fkChain",
        mode: "local",
        bones: fkBones,
        controls: fkBones,
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
        target: { type: "control", name: "headAim" },
      },
    ],
    metadata: {
      name: `Kaiju ${id} Runtime Rig`,
      authoringMode: "pose-live-solve",
    },
  };
}

function applyAttackPose(
  pose: {
    hipsY: number;
    hipsRoll: number;
    spinePitch: number;
    chestPitch: number;
    chestRoll: number;
    headPitch: number;
    leftUpperLegPitch: number;
    leftLowerLegPitch: number;
    rightUpperLegPitch: number;
    rightLowerLegPitch: number;
    leftHand: THREE.Vector3;
    rightHand: THREE.Vector3;
    leftPole: THREE.Vector3;
    rightPole: THREE.Vector3;
    headAim: THREE.Vector3;
  },
  attackKind: KaijuAttackKind | null,
  progress: number,
  motion: number,
): void {
  if (!attackKind || progress >= 1) {
    return;
  }

  const t = THREE.MathUtils.clamp(progress, 0, 1);
  const windup = smoothPulse(t, 0, 0.42);
  const strike = smoothPulse(t, 0.35, 0.72);
  const recover = smoothPulse(t, 0.68, 1);
  const intensity = motion * (1 - recover * 0.65);

  if (attackKind === "stomp") {
    const lift = smoothPulse(t, 0, 0.45);
    const slam = smoothPulse(t, 0.45, 0.64);
    pose.hipsY += (lift * 1.5 - slam * 2.5) * intensity;
    pose.chestPitch += (-0.32 * windup + 0.42 * strike) * intensity;
    pose.leftHand.lerp(LOCAL.set(-8.8, 25, -5.8), windup * intensity);
    pose.rightHand.lerp(LOCAL.set(8.8, 25, -5.8), windup * intensity);
    pose.rightUpperLegPitch += (-0.72 * lift + 0.54 * strike) * intensity;
    pose.rightLowerLegPitch += (0.92 * lift - 0.3 * strike) * intensity;
    pose.headAim.lerp(LOCAL.set(0, 23, -20), strike * intensity);
    return;
  }

  if (attackKind === "swipe") {
    const sweep = smoothstep(0.28, 0.78, t);
    const rightX = THREE.MathUtils.lerp(18, -11, sweep);
    pose.chestRoll += THREE.MathUtils.lerp(-0.32, 0.42, sweep) * intensity;
    pose.chestPitch += -0.16 * windup * intensity;
    pose.rightHand.lerp(LOCAL.set(rightX, 21 + Math.sin(sweep * Math.PI) * 3.5, -8.8), intensity);
    pose.rightPole.lerp(LOCAL.set(7, 25, 7), intensity);
    pose.leftHand.lerp(LOCAL.set(-9.5, 14.2, -7), windup * intensity);
    pose.headAim.lerp(LOCAL.set(rightX * 0.4, 28, -20), strike * intensity);
    return;
  }

  const lunge = Math.sin(t * Math.PI);
  pose.hipsY += lunge * 0.8 * intensity;
  pose.spinePitch += -0.2 * windup * intensity + 0.34 * strike * intensity;
  pose.chestPitch += -0.34 * windup * intensity + 0.5 * strike * intensity;
  pose.headPitch += 0.44 * strike * intensity;
  pose.leftHand.lerp(LOCAL.set(-11, 21, -10.5), windup * intensity);
  pose.rightHand.lerp(LOCAL.set(11, 21, -10.5), windup * intensity);
  pose.headAim.lerp(LOCAL.set(0, 18, -24), Math.max(windup, strike) * intensity);
}

function attachTorsoMeshes(
  id: number,
  profile: KaijuRigProfile,
  bodyMaterial: THREE.MeshStandardMaterial,
  bellyMaterial: THREE.MeshStandardMaterial,
  hornMaterial: THREE.MeshStandardMaterial,
  clawMaterial: THREE.MeshStandardMaterial,
  bones: Record<string, THREE.Bone>,
): void {
  const body = new THREE.Mesh(new THREE.DodecahedronGeometry(9.6 + id * 0.55, 0), bodyMaterial);
  body.position.set(0, -0.8, -0.2);
  body.scale.set(1.05 * profile.bodyScale[0], 1.38 * profile.bodyScale[1], 0.82 * profile.bodyScale[2]);
  body.castShadow = true;
  body.receiveShadow = true;
  bones.Chest.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(5.8, 12, 8), bellyMaterial);
  belly.position.set(0, -1.4, -5.1);
  belly.scale.set(0.96, 1.2, 0.42);
  belly.castShadow = true;
  bones.Chest.add(belly);

  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(5.6 + id * 0.2, 1), bodyMaterial);
  head.position.set(0, 1.3, -0.7);
  head.scale.set(
    profile.bodyPlan === "blue-wolf" ? 0.98 : 1.1,
    profile.bodyPlan === "brown-gorilla" ? 0.72 : 0.82,
    profile.bodyPlan === "blue-wolf" ? 1.18 : 1,
  );
  head.castShadow = true;
  bones.Head.add(head);

  const armRadius = profile.bodyPlan === "brown-gorilla" ? 2.3 : profile.bodyPlan === "blue-wolf" ? 1.48 : 1.65;
  const forearmRadius = profile.bodyPlan === "brown-gorilla" ? 2.05 : profile.bodyPlan === "blue-wolf" ? 1.34 : 1.45;
  const thighRadius = profile.bodyPlan === "brown-gorilla" ? 2.25 : profile.bodyPlan === "blue-wolf" ? 1.9 : 2.15;
  const shinRadius = profile.bodyPlan === "brown-gorilla" ? 1.9 : profile.bodyPlan === "blue-wolf" ? 1.58 : 1.85;

  attachCapsuleBetween(bones["UpperArm.L"], bones["LowerArm.L"], armRadius, bodyMaterial);
  attachCapsuleBetween(bones["LowerArm.L"], bones["Hand.L"], forearmRadius, bodyMaterial);
  attachCapsuleBetween(bones["UpperArm.R"], bones["LowerArm.R"], armRadius, bodyMaterial);
  attachCapsuleBetween(bones["LowerArm.R"], bones["Hand.R"], forearmRadius, bodyMaterial);
  attachCapsuleBetween(bones["UpperLeg.L"], bones["LowerLeg.L"], thighRadius, bodyMaterial);
  attachCapsuleBetween(bones["LowerLeg.L"], bones["Foot.L"], shinRadius, bodyMaterial);
  attachCapsuleBetween(bones["UpperLeg.R"], bones["LowerLeg.R"], thighRadius, bodyMaterial);
  attachCapsuleBetween(bones["LowerLeg.R"], bones["Foot.R"], shinRadius, bodyMaterial);

  for (const footBone of [bones["Foot.L"], bones["Foot.R"]]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(4.8, 1.6, 5.4), bodyMaterial);
    foot.position.set(0, -0.2, -1.8);
    foot.castShadow = true;
    footBone.add(foot);
  }

  for (const handBone of [bones["Hand.L"], bones["Hand.R"]]) {
    const claw = new THREE.Mesh(new THREE.DodecahedronGeometry(2.4, 0), clawMaterial);
    claw.position.set(0, -1.8, -0.8);
    claw.scale.set(profile.bodyPlan === "brown-gorilla" ? 1.7 : 1.35, profile.bodyPlan === "blue-wolf" ? 0.58 : 0.72, 1);
    claw.castShadow = true;
    handBone.add(claw);
  }

  if (profile.bodyPlan === "blue-wolf") {
    attachBlueWolfFeatures(bodyMaterial, bellyMaterial, hornMaterial, clawMaterial, bones);
    return;
  }

  if (profile.bodyPlan === "brown-gorilla") {
    attachBrownGorillaFeatures(bodyMaterial, bellyMaterial, clawMaterial, bones);
    return;
  }

  attachLizardFeatures(bodyMaterial, hornMaterial, clawMaterial, bones);
}

function attachLizardFeatures(
  bodyMaterial: THREE.MeshStandardMaterial,
  hornMaterial: THREE.MeshStandardMaterial,
  clawMaterial: THREE.MeshStandardMaterial,
  bones: Record<string, THREE.Bone>,
): void {
  const snout = new THREE.Mesh(new THREE.BoxGeometry(4.7, 2.2, 4.8), bodyMaterial);
  snout.position.set(0, 0.7, -4.2);
  snout.scale.set(0.9, 0.75, 1);
  snout.castShadow = true;
  bones.Head.add(snout);

  for (const x of [-2.6, 2.6]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.8, 7), hornMaterial);
    horn.position.set(x, 4.6, -1.1);
    horn.rotation.x = -0.28;
    horn.castShadow = true;
    bones.Head.add(horn);
  }

  for (let spine = 0; spine < 5; spine += 1) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(1.15, 4.2, 6), clawMaterial);
    spike.position.set(0, -7 + spine * 3.8, 6.1);
    spike.rotation.x = Math.PI / 2;
    spike.castShadow = true;
    bones.Chest.add(spike);
  }

  for (let segment = 0; segment < 5; segment += 1) {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(2.45 - segment * 0.32, 6.4, 8), bodyMaterial);
    tail.position.set(0, -3.6 - segment * 0.28, 7.2 + segment * 4.2);
    tail.rotation.x = Math.PI / 2 + segment * 0.04;
    tail.castShadow = true;
    bones.Hips.add(tail);
  }
}

function attachBlueWolfFeatures(
  bodyMaterial: THREE.MeshStandardMaterial,
  bellyMaterial: THREE.MeshStandardMaterial,
  hornMaterial: THREE.MeshStandardMaterial,
  clawMaterial: THREE.MeshStandardMaterial,
  bones: Record<string, THREE.Bone>,
): void {
  const snout = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2, 5.5), bellyMaterial);
  snout.position.set(0, 0.55, -4.65);
  snout.scale.set(0.82, 0.64, 1);
  snout.castShadow = true;
  bones.Head.add(snout);

  for (const x of [-2.35, 2.35]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.95, 3.8, 5), hornMaterial);
    ear.position.set(x, 4.8, 0.2);
    ear.rotation.z = x < 0 ? 0.2 : -0.2;
    ear.castShadow = true;
    bones.Head.add(ear);
  }

  const throat = new THREE.Mesh(new THREE.ConeGeometry(2.2, 5.5, 8), bellyMaterial);
  throat.position.set(0, -4.7, -4.6);
  throat.rotation.x = Math.PI;
  throat.scale.set(0.9, 1, 0.55);
  throat.castShadow = true;
  bones.Chest.add(throat);

  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(1.25, 9.5, 5, 8), bodyMaterial);
  tail.position.set(0, -2.8, 9.1);
  tail.rotation.x = Math.PI / 2.7;
  tail.castShadow = true;
  bones.Hips.add(tail);

  for (let spine = 0; spine < 4; spine += 1) {
    const ridge = new THREE.Mesh(new THREE.ConeGeometry(0.72, 2.8, 5), clawMaterial);
    ridge.position.set(0, -5.4 + spine * 3.2, 5.9);
    ridge.rotation.x = Math.PI / 2;
    ridge.castShadow = true;
    bones.Chest.add(ridge);
  }
}

function attachBrownGorillaFeatures(
  bodyMaterial: THREE.MeshStandardMaterial,
  bellyMaterial: THREE.MeshStandardMaterial,
  clawMaterial: THREE.MeshStandardMaterial,
  bones: Record<string, THREE.Bone>,
): void {
  const brow = new THREE.Mesh(new THREE.BoxGeometry(6.6, 1.2, 1.5), clawMaterial);
  brow.position.set(0, 2.4, -3.9);
  brow.castShadow = true;
  bones.Head.add(brow);

  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.5, 3), bellyMaterial);
  muzzle.position.set(0, -0.3, -4);
  muzzle.scale.set(1, 0.78, 0.92);
  muzzle.castShadow = true;
  bones.Head.add(muzzle);

  for (const [x, boneName] of [
    [-5.2, "UpperArm.L"],
    [5.2, "UpperArm.R"],
  ] as const) {
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(3.8, 12, 8), bodyMaterial);
    shoulder.position.set(x < 0 ? -0.9 : 0.9, 0.6, 0.1);
    shoulder.scale.set(1.15, 0.92, 1.02);
    shoulder.castShadow = true;
    bones[boneName].add(shoulder);
  }

  const backPlate = new THREE.Mesh(new THREE.DodecahedronGeometry(4.8, 0), clawMaterial);
  backPlate.position.set(0, 0.3, 6.1);
  backPlate.scale.set(1.7, 1.1, 0.5);
  backPlate.castShadow = true;
  bones.Chest.add(backPlate);
}

function attachCapsuleBetween(parent: THREE.Bone, child: THREE.Bone, radius: number, material: THREE.Material): void {
  const direction = child.position.clone();
  const length = Math.max(0.5, direction.length());
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), material);
  capsule.position.copy(direction).multiplyScalar(0.5);
  capsule.quaternion.setFromUnitVectors(AXIS_Y, direction.normalize());
  capsule.castShadow = true;
  capsule.receiveShadow = true;
  parent.add(capsule);
}

function bone(name: string, position: Vec3Tuple): THREE.Bone {
  const item = new THREE.Bone();
  item.name = name;
  item.position.fromArray(position);
  return item;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function smoothPulse(value: number, start: number, end: number): number {
  const up = smoothstep(start, (start + end) * 0.5, value);
  const down = 1 - smoothstep((start + end) * 0.5, end, value);
  return Math.max(0, Math.min(up, down));
}
