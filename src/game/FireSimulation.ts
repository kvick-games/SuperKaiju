import * as THREE from "three";
import { clamp } from "./math";

const FIXED_STEP = 0.125;
const MAX_FIXED_STEPS_PER_FRAME = 3;
const MAX_ACTIVE_FIRE_NODES = 96;
const MAX_SPREAD_ATTEMPTS_PER_STEP = 24;
const MAX_SPREAD_TARGETS_PER_NODE = 3;
const SPATIAL_CELL_SIZE = 48;
const DIRECT_IGNITION_QUERY_RADIUS = 28;
const FIRE_AUDIO_RADIUS = 92;
const WIND_DIRECTION = new THREE.Vector3(0.75, 0, -0.35).normalize();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TO_TARGET = new THREE.Vector3();
const CANDIDATE_POINT = new THREE.Vector3();
const NODE_TO_LISTENER = new THREE.Vector3();

export interface BurnableBounds {
  center: THREE.Vector3;
  halfExtents: THREE.Vector3;
  radius: number;
}

export interface Burnable {
  id: string;
  position: THREE.Vector3;
  bounds: BurnableBounds;
  fuel: number;
  ignitionThreshold: number;
  spreadRadius: number;
  canBurn: () => boolean;
  onBurn: (delta: number, intensity: number, heat: number) => void;
  onIgnite?: () => void;
  onExtinguish?: () => void;
}

export interface FireNodeView {
  readonly id: number;
  readonly burnableId: string;
  readonly point: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly heat: number;
  readonly intensity: number;
  readonly fuelRemaining: number;
}

interface FireNode extends FireNodeView {
  burnable: Burnable;
  heat: number;
  intensity: number;
  fuelRemaining: number;
  nextSpreadCheck: number;
}

export class FireSimulation {
  private readonly burnables = new Map<string, Burnable>();
  private readonly spatialHash = new Map<string, Burnable[]>();
  private readonly activeNodes: FireNode[] = [];
  private readonly nodesByBurnable = new Map<string, FireNode>();
  private readonly accumulatedHeat = new Map<string, number>();
  private accumulator = 0;
  private elapsed = 0;
  private nextNodeId = 1;

  registerBurnable(burnable: Burnable): void {
    this.burnables.set(burnable.id, burnable);
    this.insertIntoSpatialHash(burnable);
  }

  clearBurnables(): void {
    this.reset();
    this.burnables.clear();
    this.spatialHash.clear();
  }

  reset(): void {
    for (const node of this.activeNodes) {
      node.burnable.onExtinguish?.();
    }
    this.activeNodes.length = 0;
    this.nodesByBurnable.clear();
    this.accumulatedHeat.clear();
    this.accumulator = 0;
    this.elapsed = 0;
    this.nextNodeId = 1;
  }

  igniteAt(point: THREE.Vector3, normal: THREE.Vector3, strength: number, sourceDirection?: THREE.Vector3): boolean {
    const target = this.findBestBurnable(point, DIRECT_IGNITION_QUERY_RADIUS);
    if (!target) {
      return false;
    }

    return this.applyHeat(target, point, normal, strength, sourceDirection);
  }

  applySuppressionCone(
    origin: THREE.Vector3,
    forward: THREE.Vector3,
    range: number,
    angleRadians: number,
    strength: number,
  ): void {
    const coneDot = Math.cos(angleRadians);

    for (let index = this.activeNodes.length - 1; index >= 0; index -= 1) {
      const node = this.activeNodes[index];
      TO_TARGET.copy(node.point).sub(origin);
      const distance = TO_TARGET.length();
      if (distance <= 0.001 || distance > range) {
        continue;
      }

      const dot = TO_TARGET.multiplyScalar(1 / distance).dot(forward);
      if (dot < coneDot) {
        continue;
      }

      const effect = (1 - distance / range) * 0.65 + 0.35;
      node.heat = Math.max(0, node.heat - strength * effect);
      node.intensity = Math.min(node.intensity, this.getIntensityFor(node));
      if (node.heat <= node.burnable.ignitionThreshold * 0.22) {
        this.extinguishNode(index);
      }
    }
  }

  update(delta: number): void {
    this.accumulator = Math.min(this.accumulator + delta, FIXED_STEP * MAX_FIXED_STEPS_PER_FRAME);
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_FIXED_STEPS_PER_FRAME) {
      this.step();
      this.accumulator -= FIXED_STEP;
      steps += 1;
    }
  }

  getActiveNodes(): readonly FireNodeView[] {
    return this.activeNodes;
  }

  getAudioIntensity(listenerPosition: THREE.Vector3): number {
    let total = 0;
    for (const node of this.activeNodes) {
      NODE_TO_LISTENER.copy(node.point).sub(listenerPosition);
      const distance = NODE_TO_LISTENER.length();
      if (distance >= FIRE_AUDIO_RADIUS) {
        continue;
      }

      const distanceFade = 1 - distance / FIRE_AUDIO_RADIUS;
      total += distanceFade * distanceFade * node.intensity;
    }

    return clamp(1 - Math.exp(-total * 0.34), 0, 1);
  }

  private step(): void {
    this.elapsed += FIXED_STEP;
    let spreadAttempts = 0;

    for (let index = this.activeNodes.length - 1; index >= 0; index -= 1) {
      const node = this.activeNodes[index];
      if (!node.burnable.canBurn()) {
        this.extinguishNode(index);
        continue;
      }

      node.heat = Math.max(0, node.heat - FIXED_STEP * 0.08);
      node.intensity = this.getIntensityFor(node);
      node.fuelRemaining -= FIXED_STEP * (3.8 + node.intensity * 5.2);
      node.burnable.onBurn(FIXED_STEP, node.intensity, node.heat);

      if (node.fuelRemaining <= 0 || node.heat <= node.burnable.ignitionThreshold * 0.18 || !node.burnable.canBurn()) {
        this.extinguishNode(index);
        continue;
      }

      if (node.nextSpreadCheck <= this.elapsed && spreadAttempts < MAX_SPREAD_ATTEMPTS_PER_STEP) {
        spreadAttempts += 1;
        this.spreadFrom(node);
        node.nextSpreadCheck = this.elapsed + 0.48 + Math.random() * 0.46;
      }
    }
  }

  private spreadFrom(node: FireNode): void {
    const candidates = this.queryBurnables(node.point, node.burnable.spreadRadius);
    let affected = 0;

    for (const candidate of candidates) {
      if (affected >= MAX_SPREAD_TARGETS_PER_NODE || candidate.id === node.burnableId || !candidate.canBurn()) {
        continue;
      }

      const distance = this.distanceToBounds(node.point, candidate.bounds);
      if (distance > node.burnable.spreadRadius) {
        continue;
      }

      CANDIDATE_POINT.copy(candidate.bounds.center);
      CANDIDATE_POINT.y = node.point.y;
      TO_TARGET.copy(CANDIDATE_POINT).sub(node.point);
      TO_TARGET.y = 0;
      if (TO_TARGET.lengthSq() > 0.001) {
        TO_TARGET.normalize();
      } else {
        TO_TARGET.copy(WORLD_UP);
      }

      const downwind = TO_TARGET.dot(WIND_DIRECTION);
      const windBias = 0.56 + ((downwind + 1) * 0.5) * 0.92;
      const falloff = 1 - distance / node.burnable.spreadRadius;
      const heatTransfer = node.intensity * falloff * windBias * 0.32;
      if (heatTransfer < 0.045) {
        continue;
      }

      this.closestPointOnBounds(node.point, candidate.bounds, CANDIDATE_POINT);
      this.applyHeat(candidate, CANDIDATE_POINT, WORLD_UP, heatTransfer, TO_TARGET);
      affected += 1;
    }
  }

  private applyHeat(
    burnable: Burnable,
    point: THREE.Vector3,
    normal: THREE.Vector3,
    amount: number,
    sourceDirection?: THREE.Vector3,
  ): boolean {
    if (!burnable.canBurn()) {
      return false;
    }

    const activeNode = this.nodesByBurnable.get(burnable.id);
    if (activeNode) {
      activeNode.heat = clamp(activeNode.heat + amount * 0.7, 0, burnable.ignitionThreshold * 2.8);
      activeNode.intensity = Math.max(activeNode.intensity, this.getIntensityFor(activeNode));
      activeNode.point.lerp(point, 0.18);
      this.copyNormal(activeNode.normal, normal, sourceDirection);
      return true;
    }

    const heat = (this.accumulatedHeat.get(burnable.id) ?? 0) + amount;
    if (heat < burnable.ignitionThreshold) {
      this.accumulatedHeat.set(burnable.id, heat);
      return false;
    }

    return this.createNode(burnable, point, normal, heat, sourceDirection);
  }

  private createNode(
    burnable: Burnable,
    point: THREE.Vector3,
    normal: THREE.Vector3,
    heat: number,
    sourceDirection?: THREE.Vector3,
  ): boolean {
    if (this.activeNodes.length >= MAX_ACTIVE_FIRE_NODES) {
      return false;
    }

    const node: FireNode = {
      id: this.nextNodeId,
      burnableId: burnable.id,
      burnable,
      point: point.clone(),
      normal: new THREE.Vector3(),
      heat: clamp(heat, burnable.ignitionThreshold, burnable.ignitionThreshold * 2.8),
      intensity: 0,
      fuelRemaining: burnable.fuel,
      nextSpreadCheck: this.elapsed + 0.24 + Math.random() * 0.32,
    };
    this.nextNodeId += 1;
    this.copyNormal(node.normal, normal, sourceDirection);
    node.intensity = this.getIntensityFor(node);
    this.activeNodes.push(node);
    this.nodesByBurnable.set(burnable.id, node);
    this.accumulatedHeat.delete(burnable.id);
    burnable.onIgnite?.();
    return true;
  }

  private extinguishNode(index: number): void {
    const node = this.activeNodes[index];
    node.burnable.onExtinguish?.();
    this.nodesByBurnable.delete(node.burnableId);
    this.activeNodes.splice(index, 1);
  }

  private getIntensityFor(node: FireNode): number {
    const heatIntensity = node.heat / Math.max(0.001, node.burnable.ignitionThreshold * 1.8);
    const fuelIntensity = clamp(node.fuelRemaining / Math.max(0.001, node.burnable.fuel * 0.16), 0, 1);
    return clamp(heatIntensity * fuelIntensity, 0.08, 1);
  }

  private findBestBurnable(point: THREE.Vector3, radius: number): Burnable | null {
    let best: Burnable | null = null;
    let bestDistance = radius;
    for (const burnable of this.queryBurnables(point, radius)) {
      if (!burnable.canBurn()) {
        continue;
      }

      const distance = this.distanceToBounds(point, burnable.bounds);
      if (distance <= bestDistance) {
        best = burnable;
        bestDistance = distance;
      }
    }

    return best;
  }

  private queryBurnables(point: THREE.Vector3, radius: number): Burnable[] {
    const minX = this.cellCoordinate(point.x - radius);
    const maxX = this.cellCoordinate(point.x + radius);
    const minZ = this.cellCoordinate(point.z - radius);
    const maxZ = this.cellCoordinate(point.z + radius);
    const results: Burnable[] = [];

    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const items = this.spatialHash.get(`${x}:${z}`);
        if (items) {
          results.push(...items);
        }
      }
    }

    return results;
  }

  private insertIntoSpatialHash(burnable: Burnable): void {
    const radius = Math.max(burnable.bounds.radius, burnable.spreadRadius * 0.5);
    const minX = this.cellCoordinate(burnable.position.x - radius);
    const maxX = this.cellCoordinate(burnable.position.x + radius);
    const minZ = this.cellCoordinate(burnable.position.z - radius);
    const maxZ = this.cellCoordinate(burnable.position.z + radius);

    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const key = `${x}:${z}`;
        const bucket = this.spatialHash.get(key);
        if (bucket) {
          bucket.push(burnable);
        } else {
          this.spatialHash.set(key, [burnable]);
        }
      }
    }
  }

  private distanceToBounds(point: THREE.Vector3, bounds: BurnableBounds): number {
    const dx = Math.max(Math.abs(point.x - bounds.center.x) - bounds.halfExtents.x, 0);
    const dy = Math.max(Math.abs(point.y - bounds.center.y) - bounds.halfExtents.y, 0);
    const dz = Math.max(Math.abs(point.z - bounds.center.z) - bounds.halfExtents.z, 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private closestPointOnBounds(point: THREE.Vector3, bounds: BurnableBounds, target: THREE.Vector3): THREE.Vector3 {
    target.set(
      clamp(point.x, bounds.center.x - bounds.halfExtents.x, bounds.center.x + bounds.halfExtents.x),
      clamp(point.y, bounds.center.y - bounds.halfExtents.y, bounds.center.y + bounds.halfExtents.y),
      clamp(point.z, bounds.center.z - bounds.halfExtents.z, bounds.center.z + bounds.halfExtents.z),
    );
    return target;
  }

  private copyNormal(target: THREE.Vector3, normal: THREE.Vector3, sourceDirection?: THREE.Vector3): void {
    if (normal.lengthSq() > 0.001) {
      target.copy(normal).normalize();
    } else if (sourceDirection && sourceDirection.lengthSq() > 0.001) {
      target.copy(sourceDirection).multiplyScalar(-1).normalize();
    } else {
      target.copy(WORLD_UP);
    }
  }

  private cellCoordinate(value: number): number {
    return Math.floor(value / SPATIAL_CELL_SIZE);
  }
}
