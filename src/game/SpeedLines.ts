import * as THREE from "three";
import { clamp, lerp, randomRange } from "./math";

interface SpeedLine {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  edgeBoost: number;
  length: number;
  speed: number;
}

const LINE_COUNT = 92;
const FRONT_Z = -42;
const BACK_Z = 18;
const RESPAWN_DEPTH_VARIANCE = 10;
const EDGE_MIN = 0.42;
const LOCAL_SCALE_BASE = 8;
const LOCAL_SCALE_DEPTH = 0.36;
const MIN_SAMPLE_DELTA = 0.001;
const MIN_DIRECTION_SPEED = 1;
const ENTRY_AXIS_MIN_SPEED = 12;
const ENTRY_SIDE_SPAWN_CHANCE = 0.74;
const HORIZONTAL_VIEW_MARGIN = 1.85;
const VERTICAL_VIEW_MARGIN = 1.45;
const FAR_REJECT_EXTRA_DEPTH = 16;

export class SpeedLines {
  readonly lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;

  private readonly positions = new Float32Array(LINE_COUNT * 2 * 3);
  private readonly streaks: SpeedLine[] = [];
  private readonly cameraWorldPosition = new THREE.Vector3();
  private readonly previousCameraWorldPosition = new THREE.Vector3();
  private readonly cameraWorldVelocity = new THREE.Vector3();
  private readonly cameraLocalVelocity = new THREE.Vector3();
  private readonly cameraInverseQuaternion = new THREE.Quaternion();
  private readonly relativeWorldVelocity = new THREE.Vector3();
  private readonly cameraLocalPosition = new THREE.Vector3();
  private readonly lineEnd = new THREE.Vector3();
  private readonly spawnLocalPosition = new THREE.Vector3();
  private readonly fallbackDirection = new THREE.Vector3();
  private intensity = 0;
  private hasCameraSample = false;

  constructor(scene: THREE.Scene, private readonly camera: THREE.Camera) {
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
    this.lines.renderOrder = 1000;
    scene.add(this.lines);
    this.sampleCameraVelocity(0);

    for (let index = 0; index < LINE_COUNT; index += 1) {
      const line = {
        position: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        edgeBoost: 0,
        length: 0,
        speed: 0,
      };
      this.resetLine(line, true);
      this.streaks.push(line);
    }

    this.syncGeometry();
  }

  update(delta: number, active: boolean, speedRatio: number): void {
    this.sampleCameraVelocity(delta);
    this.intensity = lerp(this.intensity, active ? 1 : 0, 1 - Math.exp(-9 * delta));
    this.lines.visible = this.intensity > 0.02;
    this.lines.material.opacity = 0.62 * this.intensity;

    if (!this.lines.visible) {
      return;
    }

    const speedScale = 0.82 + speedRatio * 0.42;
    for (const line of this.streaks) {
      line.position.addScaledVector(this.relativeWorldVelocity, line.speed * speedScale * delta);
      if (this.isOutsideCameraVolume(line)) {
        this.resetLine(line, false);
      }
    }

    this.syncGeometry();
  }

  private sampleCameraVelocity(delta: number): void {
    this.camera.updateMatrixWorld(true);
    this.camera.getWorldPosition(this.cameraWorldPosition);
    if (!this.hasCameraSample || delta <= 0) {
      this.previousCameraWorldPosition.copy(this.cameraWorldPosition);
      this.cameraLocalVelocity.set(0, 0, 0);
      this.cameraWorldVelocity.set(0, 0, 0);
      this.relativeWorldVelocity.set(0, 0, 0);
      this.hasCameraSample = true;
      return;
    }

    this.cameraWorldVelocity
      .copy(this.cameraWorldPosition)
      .sub(this.previousCameraWorldPosition)
      .multiplyScalar(1 / Math.max(delta, MIN_SAMPLE_DELTA));
    this.previousCameraWorldPosition.copy(this.cameraWorldPosition);
    this.camera.getWorldQuaternion(this.cameraInverseQuaternion).invert();
    this.cameraLocalVelocity.copy(this.cameraWorldVelocity).applyQuaternion(this.cameraInverseQuaternion);
    this.relativeWorldVelocity.copy(this.cameraWorldVelocity).multiplyScalar(-1);
  }

  private resetLine(line: SpeedLine, initial: boolean): void {
    const edgeSide = Math.random() > 0.5 ? 1 : -1;
    const horizontalDominant = Math.random() > 0.48;
    let x = horizontalDominant
      ? edgeSide * randomRange(Math.random, EDGE_MIN, 1.18)
      : randomRange(Math.random, -1.05, 1.05);
    let y = horizontalDominant
      ? randomRange(Math.random, -0.7, 0.7)
      : edgeSide * randomRange(Math.random, EDGE_MIN * 0.72, 0.82);

    let z = randomRange(Math.random, FRONT_Z, BACK_Z);
    if (!initial && Math.random() < ENTRY_SIDE_SPAWN_CHANCE) {
      const relativeLocalX = -this.cameraLocalVelocity.x;
      const relativeLocalY = -this.cameraLocalVelocity.y;
      const relativeLocalZ = -this.cameraLocalVelocity.z;
      const absoluteLocalX = Math.abs(relativeLocalX);
      const absoluteLocalY = Math.abs(relativeLocalY);
      const absoluteLocalZ = Math.abs(relativeLocalZ);
      const dominantSpeed = Math.max(absoluteLocalX, absoluteLocalY, absoluteLocalZ);

      if (dominantSpeed > ENTRY_AXIS_MIN_SPEED) {
        if (absoluteLocalZ >= absoluteLocalX && absoluteLocalZ >= absoluteLocalY) {
          z =
            relativeLocalZ > 0
              ? FRONT_Z + randomRange(Math.random, 0, RESPAWN_DEPTH_VARIANCE)
              : BACK_Z - randomRange(Math.random, 0, RESPAWN_DEPTH_VARIANCE);
        } else if (absoluteLocalX >= absoluteLocalY) {
          x = -Math.sign(relativeLocalX) * randomRange(Math.random, EDGE_MIN, 1.18);
          y = randomRange(Math.random, -0.74, 0.74);
        } else {
          x = randomRange(Math.random, -1.05, 1.05);
          y = -Math.sign(relativeLocalY) * randomRange(Math.random, EDGE_MIN * 0.72, 0.82);
        }
      }
    }

    const scale = LOCAL_SCALE_BASE + Math.abs(z) * LOCAL_SCALE_DEPTH;
    this.spawnLocalPosition.set(x * scale, y * scale, z);
    this.camera.localToWorld(line.position.copy(this.spawnLocalPosition));

    if (this.relativeWorldVelocity.lengthSq() > MIN_DIRECTION_SPEED * MIN_DIRECTION_SPEED) {
      line.direction.copy(this.relativeWorldVelocity).normalize();
    } else {
      this.camera.getWorldDirection(this.fallbackDirection);
      line.direction.copy(this.fallbackDirection).multiplyScalar(-1);
    }

    line.edgeBoost = clamp(Math.max(Math.abs(x), Math.abs(y)) - 0.35, 0, 1);
    line.length = randomRange(Math.random, 8, 26);
    line.speed = randomRange(Math.random, 0.72, 1.45);
  }

  private isOutsideCameraVolume(line: SpeedLine): boolean {
    this.cameraLocalPosition.copy(line.position);
    this.camera.worldToLocal(this.cameraLocalPosition);

    if (this.cameraLocalPosition.z > BACK_Z || this.cameraLocalPosition.z < FRONT_Z - FAR_REJECT_EXTRA_DEPTH) {
      return true;
    }

    const depth = Math.abs(this.cameraLocalPosition.z);
    const scale = LOCAL_SCALE_BASE + depth * LOCAL_SCALE_DEPTH;
    return (
      Math.abs(this.cameraLocalPosition.x) > scale * HORIZONTAL_VIEW_MARGIN ||
      Math.abs(this.cameraLocalPosition.y) > scale * VERTICAL_VIEW_MARGIN
    );
  }

  private syncGeometry(): void {
    for (let index = 0; index < this.streaks.length; index += 1) {
      const line = this.streaks[index];
      const lineLength = line.length * (0.72 + line.edgeBoost * 0.7);
      this.lineEnd.copy(line.position).addScaledVector(line.direction, lineLength);
      const start = index * 6;
      this.positions[start] = line.position.x;
      this.positions[start + 1] = line.position.y;
      this.positions[start + 2] = line.position.z;
      this.positions[start + 3] = this.lineEnd.x;
      this.positions[start + 4] = this.lineEnd.y;
      this.positions[start + 5] = this.lineEnd.z;
    }

    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
