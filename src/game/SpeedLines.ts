import * as THREE from "three";
import { clamp, lerp, randomRange } from "./math";

interface SpeedLine {
  x: number;
  y: number;
  z: number;
  length: number;
  speed: number;
}

const LINE_COUNT = 92;
const NEAR_Z = -8;
const FAR_Z = -126;
const EDGE_MIN = 0.42;

export class SpeedLines {
  readonly lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;

  private readonly positions = new Float32Array(LINE_COUNT * 2 * 3);
  private readonly streaks: SpeedLine[] = [];
  private intensity = 0;

  constructor(camera: THREE.Camera) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0xe8f8ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.lines.frustumCulled = false;
    camera.add(this.lines);

    for (let index = 0; index < LINE_COUNT; index += 1) {
      this.streaks.push(this.createLine(true));
    }

    this.syncGeometry();
  }

  update(delta: number, active: boolean, speedRatio: number): void {
    this.intensity = lerp(this.intensity, active ? 1 : 0, 1 - Math.exp(-9 * delta));
    this.lines.visible = this.intensity > 0.02;
    this.lines.material.opacity = 0.62 * this.intensity;

    if (!this.lines.visible) {
      return;
    }

    const velocity = 132 + speedRatio * 118;
    for (const line of this.streaks) {
      line.z += line.speed * velocity * delta;
      if (line.z > NEAR_Z) {
        Object.assign(line, this.createLine(false));
      }
    }

    this.syncGeometry();
  }

  private createLine(initial: boolean): SpeedLine {
    const edgeSide = Math.random() > 0.5 ? 1 : -1;
    const horizontalDominant = Math.random() > 0.48;
    const x = horizontalDominant
      ? edgeSide * randomRange(Math.random, EDGE_MIN, 1.18)
      : randomRange(Math.random, -1.05, 1.05);
    const y = horizontalDominant
      ? randomRange(Math.random, -0.7, 0.7)
      : edgeSide * randomRange(Math.random, EDGE_MIN * 0.72, 0.82);

    return {
      x,
      y,
      z: initial ? randomRange(Math.random, FAR_Z, NEAR_Z) : FAR_Z - randomRange(Math.random, 0, 22),
      length: randomRange(Math.random, 8, 26),
      speed: randomRange(Math.random, 0.72, 1.45),
    };
  }

  private syncGeometry(): void {
    for (let index = 0; index < this.streaks.length; index += 1) {
      const line = this.streaks[index];
      const edgeBoost = clamp(Math.max(Math.abs(line.x), Math.abs(line.y)) - 0.35, 0, 1);
      const scale = 8 + Math.abs(line.z) * 0.36;
      const x = line.x * scale;
      const y = line.y * scale;
      const lineLength = line.length * (0.72 + edgeBoost * 0.7);
      const start = index * 6;
      this.positions[start] = x;
      this.positions[start + 1] = y;
      this.positions[start + 2] = line.z;
      this.positions[start + 3] = x * 1.018;
      this.positions[start + 4] = y * 1.018;
      this.positions[start + 5] = line.z - lineLength;
    }

    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
