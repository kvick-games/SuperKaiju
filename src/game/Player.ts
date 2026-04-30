import * as THREE from "three";
import { CapeCloth } from "./CapeCloth";
import { clamp, damp, directionFromYawPitch, lerp, rightFromYaw } from "./math";
import type { City } from "./City";
import type { PlayerInputSource } from "./Input";
import type { PlayerSnapshot } from "../multiplayer/protocol";

const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const DESIRED_VELOCITY = new THREE.Vector3();
const VELOCITY_DELTA = new THREE.Vector3();
const FLIGHT_ACCELERATION = new THREE.Vector3();
const MOVE_INPUT = new THREE.Vector3();
const CAPE_WORLD_GRAVITY = new THREE.Vector3(0, -13.5, 0);
const CAPE_WORLD_QUATERNION = new THREE.Quaternion();
const CAPE_INVERSE_QUATERNION = new THREE.Quaternion();
const CAPE_LOCAL_VELOCITY = new THREE.Vector3();
const CAPE_LOCAL_GRAVITY = new THREE.Vector3();
const GROUND_SCRAPE_VELOCITY = new THREE.Vector3();
const DUST_DIRECTION = new THREE.Vector3();
const DUST_RIGHT = new THREE.Vector3();
const DUST_SCALE = new THREE.Vector3();
const DUST_MATRIX = new THREE.Matrix4();
const DUST_QUATERNION = new THREE.Quaternion();
const DUST_COLOR = new THREE.Color();
const BOOST_EMPTY_ENERGY = 0.012;
const BOOST_START_ENERGY = 0.18;
const FLIGHT_THRUST_ENERGY_DRAIN = 0.09;
const FLIGHT_GLIDE_ENERGY_RECHARGE = 0.08;
const NORMAL_MOVE_SPEED = 32;
const NORMAL_ACCELERATION = 620;
const REVERSE_BRAKE_MULTIPLIER = 2.35;
const MIN_SPEED_FOR_REVERSE_BRAKE = 0.75;
const STOPPING_FRICTION = 8.5;
const STOPPING_SNAP_SPEED = 0.35;
const SPRINT_FACING_MIN_SPEED = 4;
const FLIGHT_FORWARD_ACCELERATION = 132;
const FLIGHT_REVERSE_ACCELERATION = 92;
const FLIGHT_STRAFE_ACCELERATION = 88;
const FLIGHT_POWERED_DRAG = 0.18;
const FLIGHT_FREEFALL_DRAG = 0.035;
const FLIGHT_GRAVITY = 36;
const FLIGHT_MAX_SPEED = 162;
const FLIGHT_GROUND_FRICTION = 7.8;
const FLIGHT_DUST_MIN_SPEED = 8;
const FLIGHT_DUST_PARTICLE_COUNT = 96;
const PLAYER_VISUAL_SCALE = 0.2;
const FLIGHT_DUST_VISUAL_SCALE = PLAYER_VISUAL_SCALE;
const PLAYER_GROUND_CLEARANCE = 4.2 * PLAYER_VISUAL_SCALE;
const IDLE_HOVER_ANIMATION_SPEED_SCALE = 0.3;

interface DustParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  startRadius: number;
  maxRadius: number;
  seed: number;
  groundY: number;
}

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
  private readonly dustClouds: THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly dustParticles: DustParticle[] = [];
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
    this.dustClouds = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      FLIGHT_DUST_PARTICLE_COUNT,
    );
    this.dustClouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dustClouds.frustumCulled = false;
    this.dustClouds.visible = false;
    scene.add(this.dustClouds);
    for (let index = 0; index < FLIGHT_DUST_PARTICLE_COUNT; index += 1) {
      this.dustParticles.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
        startRadius: 0,
        maxRadius: 0,
        seed: 0,
        groundY: 0,
      });
      DUST_SCALE.setScalar(0.001);
      DUST_MATRIX.compose(this.dustParticles[index].position, DUST_QUATERNION, DUST_SCALE);
      this.dustClouds.setMatrixAt(index, DUST_MATRIX);
      this.dustClouds.setColorAt(index, DUST_COLOR.setRGB(0, 0, 0));
    }
    this.dustClouds.instanceMatrix.needsUpdate = true;
    if (this.dustClouds.instanceColor) {
      this.dustClouds.instanceColor.needsUpdate = true;
    }
    this.reset();
  }

  reset(spawnIndex = 0): void {
    this.position.set((spawnIndex - 0.5) * 7, 54 + spawnIndex * 1.8, 142 + spawnIndex * 4.5);
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
    this.group.scale.setScalar(PLAYER_VISUAL_SCALE);
    this.cape.reset();
    this.clearDust();
  }

  update(delta: number, input: PlayerInputSource, city: City): number {
    const look = input.consumeMouseDelta();
    this.yaw += look.x * 0.0022;
    this.pitch = clamp(this.pitch - look.y * 0.0018, -0.88, 0.72);

    const forward = this.getForward(FORWARD);
    const right = rightFromYaw(this.yaw, RIGHT);
    const forwardHeld = input.isDown("KeyW");
    const backHeld = input.isDown("KeyS");
    const leftHeld = input.isDown("KeyA");
    const rightHeld = input.isDown("KeyD");
    const riseHeld = input.isDown("Space");
    const descendHeld = input.isDown("ControlLeft") || input.isDown("ControlRight");
    const hasFlightTranslationInput = forwardHeld || backHeld || leftHeld || rightHeld;
    MOVE_INPUT.set(0, 0, 0);

    if (forwardHeld) {
      MOVE_INPUT.add(forward);
    }
    if (backHeld) {
      MOVE_INPUT.addScaledVector(forward, -0.72);
    }
    if (leftHeld) {
      MOVE_INPUT.addScaledVector(right, -0.82);
    }
    if (rightHeld) {
      MOVE_INPUT.addScaledVector(right, 0.82);
    }
    if (riseHeld) {
      MOVE_INPUT.add(UP);
    }
    if (descendHeld) {
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
    const applyingFlightThrust = this.boostActive && hasFlightTranslationInput;

    if (this.boostActive) {
      if (hasFlightTranslationInput) {
        FLIGHT_ACCELERATION.set(0, 0, 0);
        if (forwardHeld) {
          FLIGHT_ACCELERATION.addScaledVector(forward, FLIGHT_FORWARD_ACCELERATION);
        }
        if (backHeld) {
          FLIGHT_ACCELERATION.addScaledVector(forward, -FLIGHT_REVERSE_ACCELERATION);
        }
        if (leftHeld) {
          FLIGHT_ACCELERATION.addScaledVector(right, -FLIGHT_STRAFE_ACCELERATION);
        }
        if (rightHeld) {
          FLIGHT_ACCELERATION.addScaledVector(right, FLIGHT_STRAFE_ACCELERATION);
        }
        this.velocity.addScaledVector(FLIGHT_ACCELERATION, delta);
        this.velocity.multiplyScalar(Math.exp(-FLIGHT_POWERED_DRAG * delta));
        this.drainEnergy(FLIGHT_THRUST_ENERGY_DRAIN * delta);
        if (this.energy <= BOOST_EMPTY_ENERGY) {
          this.boostActive = false;
          this.boostLockedOut = true;
        }
      } else {
        this.velocity.y -= FLIGHT_GRAVITY * delta;
        this.velocity.multiplyScalar(Math.exp(-FLIGHT_FREEFALL_DRAG * delta));
        this.rechargeEnergy(FLIGHT_GLIDE_ENERGY_RECHARGE * delta);
      }

      const flightSpeed = this.velocity.length();
      if (flightSpeed > FLIGHT_MAX_SPEED) {
        this.velocity.multiplyScalar(FLIGHT_MAX_SPEED / flightSpeed);
      }
    } else if (hasMovementInput) {
      DESIRED_VELOCITY.copy(MOVE_INPUT).multiplyScalar(NORMAL_MOVE_SPEED);
      VELOCITY_DELTA.copy(DESIRED_VELOCITY).sub(this.velocity);

      const speed = this.velocity.length();
      const reversing = speed > MIN_SPEED_FOR_REVERSE_BRAKE && this.velocity.dot(MOVE_INPUT) < 0;
      const acceleration = NORMAL_ACCELERATION * (reversing ? REVERSE_BRAKE_MULTIPLIER : 1);
      const maxVelocityChange = acceleration * delta;
      const neededVelocityChange = VELOCITY_DELTA.length();

      if (neededVelocityChange <= maxVelocityChange) {
        this.velocity.copy(DESIRED_VELOCITY);
      } else if (neededVelocityChange > 0) {
        this.velocity.addScaledVector(VELOCITY_DELTA, maxVelocityChange / neededVelocityChange);
      }
    } else if (this.velocity.lengthSq() > 0) {
      this.velocity.multiplyScalar(Math.exp(-STOPPING_FRICTION * delta));
      if (this.velocity.lengthSq() < STOPPING_SNAP_SPEED * STOPPING_SNAP_SPEED) {
        this.velocity.set(0, 0, 0);
      }
    }

    this.boostStatus = this.boostActive
      ? applyingFlightThrust
        ? "Boosting"
        : "Gliding"
      : boostHeld && this.boostLockedOut
        ? "Drained"
        : this.energy < BOOST_START_ENERGY
          ? "Charging"
          : "Shift";

    this.position.addScaledVector(this.velocity, delta);
    const sprintBuildingImpacts = city.resolvePlayerBuildingCollision(this.position, this.velocity, this.boostActive);

    const groundY = city.getTerrainHeightAt(this.position.x, this.position.z);
    const playerFloorY = groundY + PLAYER_GROUND_CLEARANCE;
    const hitGround = this.position.y <= playerFloorY;
    const groundImpactSpeed = hitGround ? Math.max(0, -this.velocity.y) : 0;
    this.position.y = Math.max(this.position.y, playerFloorY);
    if (this.position.y <= playerFloorY && this.velocity.y < 0) {
      this.velocity.y = 0;
    }
    if (this.boostActive && hitGround) {
      const horizontalSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
      if (horizontalSpeed > FLIGHT_DUST_MIN_SPEED || groundImpactSpeed > FLIGHT_DUST_MIN_SPEED) {
        GROUND_SCRAPE_VELOCITY.set(this.velocity.x, 0, this.velocity.z);
        this.emitGroundDust(GROUND_SCRAPE_VELOCITY, Math.max(horizontalSpeed, groundImpactSpeed), city);
      }
      const groundFriction = Math.exp(-FLIGHT_GROUND_FRICTION * delta);
      this.velocity.x *= groundFriction;
      this.velocity.z *= groundFriction;
      if (horizontalSpeed < STOPPING_SNAP_SPEED) {
        this.velocity.x = 0;
        this.velocity.z = 0;
      }
    }
    this.updateDust(delta, city);

    if (!this.boostActive) {
      this.rechargeEnergy(0.1 * delta);
    }

    const movementSpeed = this.velocity.length();
    const sprintFacingActive = this.boostActive && movementSpeed > SPRINT_FACING_MIN_SPEED;
    const lateral = leftHeld ? 1 : rightHeld ? -1 : 0;
    this.hoverPose = damp(this.hoverPose, hasMovementInput || sprintFacingActive ? 0 : 1, 5.4, delta);
    this.hoverTime += delta * (1.9 + this.hoverPose * 0.75) * IDLE_HOVER_ANIMATION_SPEED_SCALE;
    this.bank = damp(this.bank, lateral * 0.42, 7, delta);

    const bobOffset = Math.sin(this.hoverTime * Math.PI * 2) * 0.82 * this.hoverPose;
    const velocityYaw = sprintFacingActive ? Math.atan2(this.velocity.x, -this.velocity.z) : this.yaw;
    const horizontalVelocity = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
    const flightPitch = sprintFacingActive ? Math.atan2(this.velocity.y, horizontalVelocity) : -this.pitch * 0.34;
    const uprightPitch = Math.PI / 2 + Math.sin(this.hoverTime * Math.PI * 2 + 0.8) * 0.035;
    const visualPitch = lerp(flightPitch, uprightPitch, this.hoverPose);
    const visualBank = lerp(this.bank, 0, this.hoverPose);

    this.group.position.copy(this.position);
    this.group.position.y += bobOffset;
    this.group.rotation.set(visualPitch, -velocityYaw, visualBank);
    this.cape.mesh.rotation.x = lerp(-0.22 - this.velocity.length() * 0.0011, -0.72, this.hoverPose);
    this.group.updateMatrixWorld(true);
    this.cape.mesh.getWorldQuaternion(CAPE_WORLD_QUATERNION);
    CAPE_INVERSE_QUATERNION.copy(CAPE_WORLD_QUATERNION).invert();
    CAPE_LOCAL_VELOCITY.copy(this.velocity).applyQuaternion(CAPE_INVERSE_QUATERNION);
    CAPE_LOCAL_GRAVITY.copy(CAPE_WORLD_GRAVITY).applyQuaternion(CAPE_INVERSE_QUATERNION);
    this.cape.update(delta, CAPE_LOCAL_VELOCITY, CAPE_LOCAL_GRAVITY, this.bank, this.pitch, this.boostActive);
    return sprintBuildingImpacts;
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

  createSnapshot(id: string, name: string, power: Pick<PlayerSnapshot, "heatActive" | "frostActive" | "heatStatus" | "frostStatus">): PlayerSnapshot {
    return {
      id,
      name,
      position: [this.position.x, this.position.y, this.position.z],
      velocity: [this.velocity.x, this.velocity.y, this.velocity.z],
      yaw: this.yaw,
      pitch: this.pitch,
      energy: this.energy,
      boostActive: this.boostActive,
      boostStatus: this.boostStatus,
      heatActive: power.heatActive,
      frostActive: power.frostActive,
      heatStatus: power.heatStatus,
      frostStatus: power.frostStatus,
      visible: this.group.visible,
    };
  }

  applySnapshot(snapshot: PlayerSnapshot): void {
    this.position.set(snapshot.position[0], snapshot.position[1], snapshot.position[2]);
    this.velocity.set(snapshot.velocity[0], snapshot.velocity[1], snapshot.velocity[2]);
    this.yaw = snapshot.yaw;
    this.pitch = snapshot.pitch;
    this.energy = snapshot.energy;
    this.boostActive = snapshot.boostActive;
    this.boostStatus = snapshot.boostStatus;
    this.group.visible = snapshot.visible;
    this.group.position.copy(this.position);
    this.group.rotation.set(Math.PI / 2 - this.pitch * 0.22, -this.yaw, 0);
    this.group.scale.setScalar(PLAYER_VISUAL_SCALE);
    this.group.updateMatrixWorld(true);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    this.dustClouds.visible = visible && this.dustClouds.visible;
  }

  private emitGroundDust(groundVelocity: THREE.Vector3, impactSpeed: number, city: City): void {
    if (groundVelocity.lengthSq() > 0.001) {
      DUST_DIRECTION.copy(groundVelocity).normalize();
    } else {
      DUST_DIRECTION.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    }
    DUST_RIGHT.set(-DUST_DIRECTION.z, 0, DUST_DIRECTION.x);
    const emitCount = Math.min(22, Math.max(6, Math.floor(impactSpeed * 0.16)));

    for (let emitted = 0; emitted < emitCount; emitted += 1) {
      const particle = this.dustParticles.find((candidate) => candidate.life <= 0);
      if (!particle) {
        return;
      }

      const side = (Math.random() - 0.5) * 13.5 * FLIGHT_DUST_VISUAL_SCALE;
      const backscatter = 6 + Math.random() * 24 + impactSpeed * 0.1;
      const cross = (Math.random() - 0.5) * 18 * FLIGHT_DUST_VISUAL_SCALE;
      particle.position
        .copy(this.position)
        .addScaledVector(DUST_RIGHT, side)
        .addScaledVector(DUST_DIRECTION, (-3.8 - Math.random() * 8.4) * FLIGHT_DUST_VISUAL_SCALE);
      particle.groundY = city.getTerrainHeightAt(particle.position.x, particle.position.z);
      particle.position.y = particle.groundY + (0.65 + Math.random() * 0.75) * FLIGHT_DUST_VISUAL_SCALE;
      particle.velocity
        .copy(DUST_DIRECTION)
        .multiplyScalar(-backscatter)
        .addScaledVector(DUST_RIGHT, cross)
        .addScaledVector(UP, (2.2 + Math.random() * 6.6 + impactSpeed * 0.025) * FLIGHT_DUST_VISUAL_SCALE);
      particle.life = 0.55 + Math.random() * 0.42;
      particle.maxLife = particle.life;
      particle.startRadius = (2.8 + Math.random() * 3.2) * FLIGHT_DUST_VISUAL_SCALE;
      particle.maxRadius =
        particle.startRadius +
        (4.8 + Math.random() * 5.8 + clamp(impactSpeed * 0.035, 0, 4.8)) * FLIGHT_DUST_VISUAL_SCALE;
      particle.seed = Math.random() * Math.PI * 2;
    }
  }

  private updateDust(delta: number, city: City): void {
    let active = 0;
    for (let index = 0; index < this.dustParticles.length; index += 1) {
      const particle = this.dustParticles[index];

      if (particle.life > 0) {
        active += 1;
        particle.life = Math.max(0, particle.life - delta);
        particle.velocity.y -= 4.8 * delta;
        particle.velocity.multiplyScalar(Math.max(0, 1 - delta * 1.15));
        particle.position.addScaledVector(particle.velocity, delta);
        particle.groundY = city.getTerrainHeightAt(particle.position.x, particle.position.z);
        particle.position.y = Math.max(particle.groundY + 0.08, particle.position.y);

        const fade = particle.life / Math.max(0.001, particle.maxLife);
        const age = 1 - fade;
        const grow = age * age * (3 - 2 * age);
        const radius = lerp(particle.startRadius, particle.maxRadius, grow) * clamp(fade * 3, 0, 1);
        const stretch = 1 + Math.sin(age * 7.5 + particle.seed) * 0.12;
        DUST_SCALE.set(radius * 1.22 * stretch, radius * (0.38 + age * 0.34), radius * 0.92);
        DUST_MATRIX.compose(particle.position, DUST_QUATERNION, DUST_SCALE);
        this.dustClouds.setMatrixAt(index, DUST_MATRIX);

        const warmth = 0.48 + fade * 0.28;
        DUST_COLOR.setRGB(warmth, warmth * 0.82, warmth * 0.58);
        this.dustClouds.setColorAt(index, DUST_COLOR);
      } else {
        DUST_SCALE.setScalar(0.001);
        DUST_MATRIX.compose(particle.position, DUST_QUATERNION, DUST_SCALE);
        this.dustClouds.setMatrixAt(index, DUST_MATRIX);
        this.dustClouds.setColorAt(index, DUST_COLOR.setRGB(0, 0, 0));
      }
    }

    this.dustClouds.visible = active > 0;
    this.dustClouds.material.opacity = active > 0 ? 0.44 : 0;
    this.dustClouds.instanceMatrix.needsUpdate = true;
    if (this.dustClouds.instanceColor) {
      this.dustClouds.instanceColor.needsUpdate = true;
    }
  }

  private clearDust(): void {
    for (let index = 0; index < this.dustParticles.length; index += 1) {
      const particle = this.dustParticles[index];
      particle.life = 0;
      DUST_SCALE.setScalar(0.001);
      DUST_MATRIX.compose(particle.position, DUST_QUATERNION, DUST_SCALE);
      this.dustClouds.setMatrixAt(index, DUST_MATRIX);
      this.dustClouds.setColorAt(index, DUST_COLOR.setRGB(0, 0, 0));
    }
    this.dustClouds.instanceMatrix.needsUpdate = true;
    if (this.dustClouds.instanceColor) {
      this.dustClouds.instanceColor.needsUpdate = true;
    }
    this.dustClouds.visible = false;
    this.dustClouds.material.opacity = 0;
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
