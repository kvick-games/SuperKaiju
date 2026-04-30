import * as THREE from "three";
import type { Vec3Tuple } from "../core/index.js";
import { ThreeSkeletonBinder } from "./ThreeSkeletonBinder.js";

export interface RagdollSkeletonOptions {
  boneNames?: string[];
  pinnedBones?: string[];
  gravity?: Vec3Tuple;
  floorY?: number;
  damping?: number;
  solverIterations?: number;
  stiffness?: number;
  particleRadius?: number;
  maxDelta?: number;
}

export interface RagdollImpulse {
  boneNames?: string[];
  position?: Vec3Tuple;
  radius?: number;
  vector?: Vec3Tuple;
  strength?: number;
}

interface RagdollParticle {
  name: string;
  position: THREE.Vector3;
  previous: THREE.Vector3;
  inverseMass: number;
  radius: number;
}

interface RagdollConstraint {
  parentName: string;
  childName: string;
  restLength: number;
  stiffness: number;
}

const DEFAULT_GRAVITY = new THREE.Vector3(0, -90, 0);
const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();
const TMP_DELTA = new THREE.Vector3();

export class RagdollSkeleton {
  private readonly particles = new Map<string, RagdollParticle>();
  private readonly constraints: RagdollConstraint[] = [];
  private readonly gravity: THREE.Vector3;
  private readonly floorY: number;
  private readonly damping: number;
  private readonly solverIterations: number;
  private readonly stiffness: number;
  private readonly particleRadius: number;
  private readonly maxDelta: number;
  private enabled = false;

  constructor(
    private readonly binder: ThreeSkeletonBinder,
    options: RagdollSkeletonOptions = {},
  ) {
    this.gravity = tupleToVector(options.gravity).multiplyScalar(1);
    if (this.gravity.lengthSq() === 0 && !options.gravity) {
      this.gravity.copy(DEFAULT_GRAVITY);
    }
    this.floorY = options.floorY ?? 0;
    this.damping = options.damping ?? 0.965;
    this.solverIterations = options.solverIterations ?? 7;
    this.stiffness = options.stiffness ?? 0.92;
    this.particleRadius = options.particleRadius ?? 0.8;
    this.maxDelta = options.maxDelta ?? 1 / 30;

    const included = new Set(options.boneNames ?? binder.getBoneNames());
    const pinned = new Set(options.pinnedBones ?? []);
    binder.updateWorldMatrices();

    for (const name of included) {
      const world = binder.getBoneWorldTransform(name);
      const particle = {
        name,
        position: tupleToVector(world.position),
        previous: tupleToVector(world.position),
        inverseMass: pinned.has(name) ? 0 : 1,
        radius: this.particleRadius,
      };
      this.particles.set(name, particle);
    }

    for (const name of included) {
      const parentName = binder.getBoneParent(name);
      if (!parentName || !included.has(parentName)) {
        continue;
      }

      const parent = this.particles.get(parentName);
      const child = this.particles.get(name);
      if (!parent || !child) {
        continue;
      }

      this.constraints.push({
        parentName,
        childName: name,
        restLength: parent.position.distanceTo(child.position),
        stiffness: this.stiffness,
      });
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    if (enabled && !this.enabled) {
      this.capturePose();
    }
    this.enabled = enabled;
  }

  capturePose(): void {
    this.binder.updateWorldMatrices();
    for (const particle of this.particles.values()) {
      const world = this.binder.getBoneWorldTransform(particle.name);
      particle.position.fromArray(world.position);
      particle.previous.copy(particle.position);
    }
  }

  applyImpulse(impulse: RagdollImpulse): void {
    const strength = impulse.strength ?? 1;
    const affectedNames = impulse.boneNames ? new Set(impulse.boneNames) : null;
    const center = impulse.position ? tupleToVector(impulse.position) : null;
    const radius = impulse.radius ?? 1;
    const vector = impulse.vector ? tupleToVector(impulse.vector) : null;

    for (const particle of this.particles.values()) {
      if (particle.inverseMass <= 0 || (affectedNames && !affectedNames.has(particle.name))) {
        continue;
      }

      TMP_DELTA.set(0, 0, 0);
      if (vector) {
        TMP_DELTA.add(vector);
      }

      if (center) {
        const distance = particle.position.distanceTo(center);
        if (distance > radius) {
          continue;
        }
        const falloff = 1 - distance / Math.max(0.001, radius);
        TMP_A.copy(particle.position).sub(center);
        if (TMP_A.lengthSq() < 0.001) {
          TMP_A.set(0, 1, 0);
        }
        TMP_A.normalize().multiplyScalar(falloff);
        TMP_DELTA.add(TMP_A);
      }

      particle.previous.addScaledVector(TMP_DELTA, -strength * particle.inverseMass);
    }
  }

  translate(offset: Vec3Tuple): void {
    const delta = tupleToVector(offset);
    if (delta.lengthSq() <= 0) {
      return;
    }

    for (const particle of this.particles.values()) {
      particle.position.add(delta);
      particle.previous.add(delta);
    }
  }

  update(delta: number): void {
    if (!this.enabled) {
      return;
    }

    const step = Math.min(delta, this.maxDelta);
    const stepSq = step * step;

    for (const particle of this.particles.values()) {
      if (particle.inverseMass <= 0) {
        continue;
      }

      TMP_A.copy(particle.position);
      TMP_B.copy(particle.position).sub(particle.previous).multiplyScalar(this.damping);
      particle.position.add(TMP_B).addScaledVector(this.gravity, stepSq);
      particle.previous.copy(TMP_A);

      const minY = this.floorY + particle.radius;
      if (particle.position.y < minY) {
        particle.position.y = minY;
        particle.previous.y = minY;
        particle.previous.x += (particle.position.x - particle.previous.x) * 0.36;
        particle.previous.z += (particle.position.z - particle.previous.z) * 0.36;
      }
    }

    for (let iteration = 0; iteration < this.solverIterations; iteration += 1) {
      this.solveConstraints();
    }

    this.applyToSkeleton();
  }

  getParticlePosition(name: string, target = new THREE.Vector3()): THREE.Vector3 {
    const particle = this.particles.get(name);
    if (!particle) {
      throw new Error(`Unknown ragdoll particle: ${name}`);
    }
    return target.copy(particle.position);
  }

  syncPose(): void {
    if (!this.enabled) {
      return;
    }

    this.applyToSkeleton();
  }

  private solveConstraints(): void {
    for (const constraint of this.constraints) {
      const parent = this.particles.get(constraint.parentName);
      const child = this.particles.get(constraint.childName);
      if (!parent || !child) {
        continue;
      }

      TMP_DELTA.copy(child.position).sub(parent.position);
      const length = TMP_DELTA.length();
      if (length < 0.0001) {
        continue;
      }

      const totalInverseMass = parent.inverseMass + child.inverseMass;
      if (totalInverseMass <= 0) {
        continue;
      }

      const correction = ((length - constraint.restLength) / length) * constraint.stiffness;
      TMP_DELTA.multiplyScalar(correction);
      parent.position.addScaledVector(TMP_DELTA, parent.inverseMass / totalInverseMass);
      child.position.addScaledVector(TMP_DELTA, -child.inverseMass / totalInverseMass);
    }
  }

  private applyToSkeleton(): void {
    for (const particle of this.particles.values()) {
      this.binder.setBoneWorldPosition(particle.name, vectorToTuple(particle.position));
    }
    this.binder.updateWorldMatrices();

    for (const constraint of this.constraints) {
      const child = this.particles.get(constraint.childName);
      if (child) {
        this.binder.lookAtBone(constraint.parentName, vectorToTuple(child.position));
      }
    }
    this.binder.updateWorldMatrices();
  }
}

export function createRagdollSkeleton(
  binder: ThreeSkeletonBinder,
  options: RagdollSkeletonOptions = {},
): RagdollSkeleton {
  return new RagdollSkeleton(binder, options);
}

function tupleToVector(value: Vec3Tuple | undefined): THREE.Vector3 {
  if (!value) {
    return DEFAULT_GRAVITY.clone();
  }
  return new THREE.Vector3(value[0], value[1], value[2]);
}

function vectorToTuple(value: THREE.Vector3): Vec3Tuple {
  return [value.x, value.y, value.z];
}
