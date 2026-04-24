import * as THREE from "three";
import { clamp } from "./math";

interface ClothParticle {
  position: THREE.Vector3;
  previous: THREE.Vector3;
  rest: THREE.Vector3;
  pinned: boolean;
}

interface ClothConstraint {
  a: number;
  b: number;
  distance: number;
}

const CAPE_WIDTH = 5.3;
const CAPE_HEIGHT = 8.4;
const COLUMNS = 11;
const ROWS = 15;
const DAMPING = 0.972;
const CONSTRAINT_ITERATIONS = 5;
const SIDE_STIFFNESS = 10;
const VERTICAL_STIFFNESS = 8.5;
const TRAIL_STIFFNESS = 16;

const ACCELERATION = new THREE.Vector3();

export class CapeCloth {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

  private readonly particles: ClothParticle[] = [];
  private readonly constraints: ClothConstraint[] = [];
  private readonly positions: Float32Array;
  private elapsed = 0;

  constructor() {
    const geometry = this.createGeometry();
    this.positions = geometry.attributes.position.array as Float32Array;
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x9f3e32,
        roughness: 0.78,
        metalness: 0.02,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.name = "Simulated hero cape";
    this.mesh.position.set(0, -0.42, 3.1);
    this.mesh.rotation.x = -0.22;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  reset(): void {
    this.elapsed = 0;
    for (const particle of this.particles) {
      particle.position.copy(particle.rest);
      particle.previous.copy(particle.rest);
    }
    this.syncGeometry();
  }

  update(
    delta: number,
    localVelocity: THREE.Vector3,
    localGravity: THREE.Vector3,
    bank: number,
    pitch: number,
    boostActive: boolean,
  ): void {
    const step = Math.min(delta, 1 / 30);
    this.elapsed += step;
    const speed = localVelocity.length();
    const speedFactor = clamp(speed / 112, 0, 1.25);
    const forwardFlow = clamp(-localVelocity.z / 112, -0.45, 1.25);
    const lateralFlow = clamp(-localVelocity.x / 112, -1.25, 1.25);
    const verticalFlow = clamp(-localVelocity.y / 112, -0.65, 0.65);
    const rearwardFlow = Math.max(0, forwardFlow);
    const boost = boostActive ? 1.35 : 1;

    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      if (particle.pinned) {
        particle.position.copy(particle.rest);
        particle.previous.copy(particle.rest);
        continue;
      }

      const row = Math.floor(index / COLUMNS);
      const column = index % COLUMNS;
      const rowT = row / (ROWS - 1);
      const columnT = column / (COLUMNS - 1) - 0.5;
      const tailT = rowT * rowT;
      const broadWave = Math.sin(this.elapsed * (4.8 + speedFactor * 7.2) + columnT * 4.2 + rowT * 5.7);
      const quickWave = Math.sin(this.elapsed * (11.6 + speedFactor * 9.4) - columnT * 9.8 + rowT * 13.2);
      const edgeWave =
        Math.sin(this.elapsed * (6.7 + speedFactor * 5.1) + columnT * 15.4) * Math.abs(columnT);
      const flutter =
        (broadWave * 0.72 + quickWave * 0.28 + edgeWave * 0.32) *
        (0.32 + tailT * 1.85) *
        (0.65 + speedFactor * 1.1) *
        boost;
      const trailTarget = tailT * (1.25 + rearwardFlow * 6.25 * boost + speedFactor * 1.45) + flutter;
      const sideTarget =
        -bank * rowT * (1.5 + rowT) +
        lateralFlow * rowT * (4.1 + tailT * 2.2) +
        (Math.cos(this.elapsed * (5.6 + speedFactor * 6.4) + rowT * 9.1) * 0.18 + edgeWave * 0.42) *
          rowT *
          (0.5 + speedFactor);
      const verticalTarget =
        particle.rest.y +
        pitch * rowT * 0.9 +
        verticalFlow * rowT * 1.35 +
        Math.sin(this.elapsed * (5.4 + speedFactor * 3.2) + rowT * 8.3 + columnT * 2.4) *
          rowT *
          (0.2 + speedFactor * 0.16);
      const localX = particle.position.x - particle.rest.x;
      const gravityScale = 0.62 + rowT * 0.88;

      ACCELERATION.set(
        (sideTarget - localX) * (SIDE_STIFFNESS + speedFactor * 10) +
          columnT * speedFactor * 3.5 +
          localGravity.x * gravityScale,
        (verticalTarget - particle.position.y) * VERTICAL_STIFFNESS + localGravity.y * gravityScale,
        (trailTarget - particle.position.z) * (TRAIL_STIFFNESS + speedFactor * 18) +
          quickWave * rowT * (3.5 + speedFactor * 6) +
          localGravity.z * gravityScale,
      );

      const velocityX = (particle.position.x - particle.previous.x) * DAMPING;
      const velocityY = (particle.position.y - particle.previous.y) * DAMPING;
      const velocityZ = (particle.position.z - particle.previous.z) * DAMPING;
      particle.previous.copy(particle.position);
      particle.position.x += velocityX + ACCELERATION.x * step * step;
      particle.position.y += velocityY + ACCELERATION.y * step * step;
      particle.position.z += velocityZ + ACCELERATION.z * step * step;

      const maxTrail = 2.8 + rowT * (5.9 + speedFactor * 3.8);
      particle.position.z = clamp(particle.position.z, -0.8, maxTrail);
      particle.position.x = clamp(particle.position.x, -CAPE_WIDTH * 0.78, CAPE_WIDTH * 0.78);
      particle.position.y = Math.min(particle.position.y, CAPE_HEIGHT * 0.5);
    }

    for (let iteration = 0; iteration < CONSTRAINT_ITERATIONS; iteration += 1) {
      this.satisfyConstraints();
    }

    this.syncGeometry();
  }

  private createGeometry(): THREE.BufferGeometry {
    const vertices: number[] = [];
    const indices: number[] = [];
    const dx = CAPE_WIDTH / (COLUMNS - 1);
    const dy = CAPE_HEIGHT / (ROWS - 1);

    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        const columnT = column / (COLUMNS - 1);
        const rowT = row / (ROWS - 1);
        const taper = 1 - rowT * 0.22;
        const x = (columnT - 0.5) * CAPE_WIDTH * taper;
        const y = CAPE_HEIGHT * 0.5 - row * dy;
        const z = Math.sin(columnT * Math.PI * 2) * 0.12 * rowT;
        const rest = new THREE.Vector3(x, y, z);
        const pinned = row === 0 || (row === 1 && (column === 0 || column === COLUMNS - 1));
        this.particles.push({
          position: rest.clone(),
          previous: rest.clone(),
          rest,
          pinned,
        });
        vertices.push(x, y, z);
      }
    }

    for (let row = 0; row < ROWS - 1; row += 1) {
      for (let column = 0; column < COLUMNS - 1; column += 1) {
        const a = row * COLUMNS + column;
        const b = a + 1;
        const c = a + COLUMNS;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        const current = row * COLUMNS + column;
        if (column < COLUMNS - 1) {
          this.addConstraint(current, current + 1);
        }
        if (row < ROWS - 1) {
          this.addConstraint(current, current + COLUMNS);
        }
        if (column < COLUMNS - 1 && row < ROWS - 1) {
          this.addConstraint(current, current + COLUMNS + 1);
        }
        if (column > 0 && row < ROWS - 1) {
          this.addConstraint(current, current + COLUMNS - 1);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private addConstraint(a: number, b: number): void {
    this.constraints.push({
      a,
      b,
      distance: this.particles[a].rest.distanceTo(this.particles[b].rest),
    });
  }

  private satisfyConstraints(): void {
    for (const constraint of this.constraints) {
      const first = this.particles[constraint.a];
      const second = this.particles[constraint.b];
      const delta = second.position.clone().sub(first.position);
      const currentDistance = delta.length();
      if (currentDistance <= 0.0001) {
        continue;
      }

      const correction = delta.multiplyScalar((currentDistance - constraint.distance) / currentDistance);
      if (!first.pinned && !second.pinned) {
        first.position.addScaledVector(correction, 0.5);
        second.position.addScaledVector(correction, -0.5);
      } else if (!first.pinned) {
        first.position.add(correction);
      } else if (!second.pinned) {
        second.position.addScaledVector(correction, -1);
      }
    }
  }

  private syncGeometry(): void {
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      const positionIndex = index * 3;
      this.positions[positionIndex] = particle.position.x;
      this.positions[positionIndex + 1] = particle.position.y;
      this.positions[positionIndex + 2] = particle.position.z;
    }

    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}
