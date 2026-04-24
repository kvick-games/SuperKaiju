import * as THREE from "three";
import { CapeCloth } from "./CapeCloth";
import { clamp, damp, directionFromYawPitch, lerp, rightFromYaw } from "./math";
import type { InputController } from "./Input";

const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const DESIRED_VELOCITY = new THREE.Vector3();
const MOVE_INPUT = new THREE.Vector3();
const CAPE_WORLD_GRAVITY = new THREE.Vector3(0, -13.5, 0);
const CAPE_WORLD_QUATERNION = new THREE.Quaternion();
const CAPE_INVERSE_QUATERNION = new THREE.Quaternion();
const CAPE_LOCAL_VELOCITY = new THREE.Vector3();
const CAPE_LOCAL_GRAVITY = new THREE.Vector3();
const BOOST_EMPTY_ENERGY = 0.012;
const BOOST_START_ENERGY = 0.18;

export class Player {
  readonly position = new THREE.Vector3(0, 54, 142);
  readonly velocity = new THREE.Vector3();
  readonly group = new THREE.Group();

  yaw = 0;
  pitch = -0.08;
  energy = 1;
  boostActive = false;
  boostStatus = "Shift";

  private readonly cape: CapeCloth;
  private boostLockedOut = false;
  private bank = 0;
  private hoverPose = 1;
  private hoverTime = 0;

  constructor(scene: THREE.Scene) {
    this.group.name = "Sky Warden player";
    this.group.add(this.createHeroMesh());
    this.cape = new CapeCloth();
    this.group.add(this.cape.mesh);
    scene.add(this.group);
    this.reset();
  }

  reset(): void {
    this.position.set(0, 54, 142);
    this.velocity.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = -0.08;
    this.energy = 1;
    this.boostActive = false;
    this.boostLockedOut = false;
    this.boostStatus = "Shift";
    this.bank = 0;
    this.hoverPose = 1;
    this.hoverTime = 0;
    this.group.position.copy(this.position);
    this.group.rotation.set(0, 0, 0);
    this.cape.reset();
  }

  update(delta: number, input: InputController): void {
    const look = input.consumeMouseDelta();
    this.yaw += look.x * 0.0022;
    this.pitch = clamp(this.pitch - look.y * 0.0018, -0.88, 0.72);

    const forward = this.getForward(FORWARD);
    const right = rightFromYaw(this.yaw, RIGHT);
    MOVE_INPUT.set(0, 0, 0);

    if (input.isDown("KeyW")) {
      MOVE_INPUT.add(forward);
    }
    if (input.isDown("KeyS")) {
      MOVE_INPUT.addScaledVector(forward, -0.72);
    }
    if (input.isDown("KeyA")) {
      MOVE_INPUT.addScaledVector(right, -0.82);
    }
    if (input.isDown("KeyD")) {
      MOVE_INPUT.addScaledVector(right, 0.82);
    }
    if (input.isDown("Space")) {
      MOVE_INPUT.add(UP);
    }
    if (input.isDown("ControlLeft") || input.isDown("ControlRight")) {
      MOVE_INPUT.addScaledVector(UP, -1);
    }

    const hasMovementInput = MOVE_INPUT.lengthSq() > 0;
    if (hasMovementInput) {
      MOVE_INPUT.normalize();
    }

    const boostHeld = input.isDown("ShiftLeft") || input.isDown("ShiftRight");
    if (!boostHeld) {
      this.boostLockedOut = false;
    }

    this.boostActive =
      boostHeld &&
      !this.boostLockedOut &&
      (this.boostActive ? this.energy > BOOST_EMPTY_ENERGY : this.energy >= BOOST_START_ENERGY);
    if (this.boostActive) {
      this.drainEnergy(0.09 * delta);
      if (this.energy <= BOOST_EMPTY_ENERGY) {
        this.boostActive = false;
        this.boostLockedOut = true;
      }
    }

    this.boostStatus = this.boostActive
      ? "Boosting"
      : boostHeld && this.boostLockedOut
        ? "Drained"
        : this.energy < BOOST_START_ENERGY
          ? "Charging"
          : "Shift";

    const targetSpeed = this.boostActive ? 112 : 62;
    DESIRED_VELOCITY.copy(MOVE_INPUT).multiplyScalar(targetSpeed);
    this.velocity.lerp(DESIRED_VELOCITY, 1 - Math.exp(-5.6 * delta));
    this.position.addScaledVector(this.velocity, delta);

    this.position.x = clamp(this.position.x, -225, 225);
    this.position.z = clamp(this.position.z, -225, 225);
    this.position.y = clamp(this.position.y, 13, 176);

    if (!this.boostActive) {
      this.rechargeEnergy(0.1 * delta);
    }

    const lateral = input.isDown("KeyA") ? 1 : input.isDown("KeyD") ? -1 : 0;
    this.hoverPose = damp(this.hoverPose, hasMovementInput ? 0 : 1, 5.4, delta);
    this.hoverTime += delta * (1.9 + this.hoverPose * 0.75);
    this.bank = damp(this.bank, lateral * 0.42, 7, delta);

    const bobOffset = Math.sin(this.hoverTime * Math.PI * 2) * 0.82 * this.hoverPose;
    const flightPitch = -this.pitch * 0.34;
    const uprightPitch = Math.PI / 2 + Math.sin(this.hoverTime * Math.PI * 2 + 0.8) * 0.035;
    const visualPitch = lerp(flightPitch, uprightPitch, this.hoverPose);
    const visualBank = lerp(this.bank, 0, this.hoverPose);

    this.group.position.copy(this.position);
    this.group.position.y += bobOffset;
    this.group.rotation.set(visualPitch, -this.yaw, visualBank);
    this.cape.mesh.rotation.x = lerp(-0.22 - this.velocity.length() * 0.0011, -0.72, this.hoverPose);
    this.group.updateMatrixWorld(true);
    this.cape.mesh.getWorldQuaternion(CAPE_WORLD_QUATERNION);
    CAPE_INVERSE_QUATERNION.copy(CAPE_WORLD_QUATERNION).invert();
    CAPE_LOCAL_VELOCITY.copy(this.velocity).applyQuaternion(CAPE_INVERSE_QUATERNION);
    CAPE_LOCAL_GRAVITY.copy(CAPE_WORLD_GRAVITY).applyQuaternion(CAPE_INVERSE_QUATERNION);
    this.cape.update(delta, CAPE_LOCAL_VELOCITY, CAPE_LOCAL_GRAVITY, this.bank, this.pitch, this.boostActive);
  }

  getForward(target = new THREE.Vector3()): THREE.Vector3 {
    return directionFromYawPitch(this.yaw, this.pitch, target);
  }

  drainEnergy(amount: number): void {
    this.energy = clamp(this.energy - amount, 0, 1);
  }

  rechargeEnergy(amount: number): void {
    this.energy = clamp(this.energy + amount, 0, 1);
  }

  private createHeroMesh(): THREE.Group {
    const hero = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({ color: 0x244f78, roughness: 0.54, metalness: 0.12 });
    const darkSuit = new THREE.MeshStandardMaterial({ color: 0x14293c, roughness: 0.64, metalness: 0.08 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd7ad54, roughness: 0.48, metalness: 0.16 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd6a47c, roughness: 0.66 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(2.1, 4.8, 5, 12), suit);
    torso.rotation.x = Math.PI / 2;
    torso.castShadow = true;
    hero.add(torso);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.18, 1.25), gold);
    chest.position.set(0, 0.72, -1.45);
    chest.castShadow = true;
    hero.add(chest);

    const head = new THREE.Mesh(new THREE.SphereGeometry(1.25, 18, 12), skin);
    head.position.set(0, 0.1, -4);
    head.scale.set(0.9, 1, 1.05);
    head.castShadow = true;
    hero.add(head);

    const shoulderGeo = new THREE.CapsuleGeometry(0.5, 4.7, 4, 10);
    const leftArm = new THREE.Mesh(shoulderGeo, darkSuit);
    leftArm.position.set(-2.95, 0, -0.7);
    leftArm.rotation.z = Math.PI / 2;
    leftArm.rotation.y = -0.16;
    leftArm.castShadow = true;
    hero.add(leftArm);

    const rightArm = leftArm.clone();
    rightArm.position.x = 2.95;
    rightArm.rotation.y = 0.16;
    hero.add(rightArm);

    const legGeo = new THREE.CapsuleGeometry(0.55, 4.2, 4, 10);
    const leftLeg = new THREE.Mesh(legGeo, suit);
    leftLeg.position.set(-0.72, -0.08, 3.35);
    leftLeg.rotation.x = -0.14;
    leftLeg.castShadow = true;
    hero.add(leftLeg);

    const rightLeg = leftLeg.clone();
    rightLeg.position.x = 0.72;
    hero.add(rightLeg);

    hero.scale.setScalar(1.1);
    return hero;
  }

}
