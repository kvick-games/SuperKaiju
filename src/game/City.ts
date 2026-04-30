import * as THREE from "three";
import { ColdComponent, type ColdEnvironment } from "./Cold";
import {
  GridCityLayoutStrategy,
  type CityLayoutBounds,
  type CityLayoutCell,
  type CityLayoutPlan,
  type CityLayoutSurface,
  type CityRoadNode,
  type CityRoadSegment,
} from "./CityLayout";
import type { Burnable } from "./FireSimulation";
import { clamp, createSeededRandom, horizontalDistance, randomRange } from "./math";
import type { CityDamageDelta } from "../multiplayer/protocol";

const TERRAIN_SIZE = 820;
const TERRAIN_SEGMENTS = 104;
const TERRAIN_AMPLITUDE = 9.5;
const TERRAIN_LOW_FREQUENCY = 0.0048;
const TERRAIN_DETAIL_FREQUENCY = 0.018;
const TERRAIN_EDGE_PADDING = 230;
const MOUNTAIN_START_PADDING = 92;
const MOUNTAIN_RISE_DISTANCE = 136;
const MOUNTAIN_MAX_HEIGHT = 86;
const MOUNTAIN_RIDGE_AMPLITUDE = 26;
const MOUNTAIN_RIDGE_FREQUENCY = 0.011;
const MOUNTAIN_DETAIL_FREQUENCY = 0.035;
const ROAD_WIDTH = 18;
const ROAD_SURFACE_OFFSET = 0.42;
const ROAD_GEOMETRY_STEP = 7;
const ROAD_SPLINE_SAMPLE_STEP = 6;
const ROAD_MASK_CELL_SIZE = 4;
const ROAD_MASK_PADDING = 18;
const ROAD_MARKING_OFFSET = 0.1;
const ROAD_MARKING_WIDTH = 0.52;
const ROAD_EDGE_MARKING_WIDTH = 0.34;
const ROAD_INTERSECTION_MARKING_CLEARANCE = 12;
const PARK_SURFACE_OFFSET = 0.095;
const BLOCK_SPACING = 42;
const CITY_GRID_RADIUS = 4;
const BUILDING_ROAD_SETBACK = 2.4;
const BUILDING_MIN_GAP = 3.5;
const TREE_COUNT = 380;
const TREE_ATTEMPTS = 2800;
const TREE_GROVE_ATTEMPTS_PER_TREE = 14;
const TREE_MIN_SPACING = 3.6;
const TREE_PARK_EDGE_CLEARANCE = 3.5;
const TREE_ROAD_CLEARANCE = 6;
const TREE_BUILDING_CLEARANCE = 5;
const TREE_SURFACE_OFFSET = 0.04;
const TRAFFIC_CAR_COUNT = 18;
const TRAFFIC_LANE_MIN_OFFSET = 1.6;
const TRAFFIC_LANE_MAX_OFFSET = 2.8;
const TRAFFIC_SURFACE_OFFSET = 0.22;
const MAX_BREAK_PARTS = 260;
const BREAK_PART_DAMAGE_STEP = 0.18;
const BREAK_PART_GRAVITY = 68;
const BREAK_PART_DUST_COLOR = new THREE.Color(0x2f2b28);
const BUILDING_DAMAGE_COLOR = new THREE.Color(0x34302d);
const BUILDING_COLD_COLOR = new THREE.Color(0xd8f3ff);
const PLAYER_COLLISION_SCALE = 0.2;
const PLAYER_BUILDING_RADIUS = 4.2 * PLAYER_COLLISION_SCALE;
const PLAYER_BUILDING_VERTICAL_RADIUS = 3.6 * PLAYER_COLLISION_SCALE;
const PLAYER_BUILDING_CLEARANCE = 0.12 * PLAYER_COLLISION_SCALE;
const PLAYER_BUILDING_COLLISION_PASSES = 2;
const PLAYER_SPRINT_DAMAGE_BASE = 14;
const PLAYER_SPRINT_DAMAGE_SPEED_SCALE = 0.22;
const FALLING_TOP_MIN_BUILDING_HEIGHT = 38;
const FALLING_TOP_MIN_HEIGHT = 16;
const FALLING_TOP_MIN_STUMP_HEIGHT = 7;
const FALLING_TOP_MAX_CUT_HEIGHT = 42;
const FALLING_TOP_MIN_DAMAGE_RATIO = 0.052;
const FALLING_TOP_GRAVITY = 58;
const FALLING_TOP_AIR_DRAG = 0.08;
const FALLING_TOP_IMPACT_PARTS = 20;
const FALLING_MEDIUM_CHUNK_MIN_COUNT = 5;
const FALLING_MEDIUM_CHUNK_MAX_COUNT = 11;
const FALLING_MEDIUM_CHUNK_MIN_HEIGHT = 4.2;
const FALLING_MEDIUM_CHUNK_MIN_HALF_EXTENT = 1.4;
const CHUNK_HEALTH_VOLUME_SCALE = 0.42;
const CHUNK_HEALTH_MIN = 34;
const CHUNK_HEALTH_BAR_WIDTH = 10;
const CHUNK_HEALTH_BAR_HEIGHT = 0.72;
const CHUNK_HEALTH_BAR_RISE = 3.4;

interface BreakableBuildingPart {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

type FallingBuildingChunkTier = "primary" | "medium";

export interface BuildingChunk {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  healthBar: THREE.Group;
  healthFill: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  halfX: number;
  halfZ: number;
  height: number;
  maxHealth: number;
  health: number;
  color: THREE.Color;
  tier: FallingBuildingChunkTier;
  destroyed: boolean;
}

type FallingBuildingTop = BuildingChunk;

interface BuildingSite {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}

interface TrafficCar {
  group: THREE.Group;
  segmentId: number;
  fromNodeId: number;
  toNodeId: number;
  progress: number;
  speed: number;
  laneOffset: number;
}

interface RoadSpline {
  road: CityRoadSegment;
  points: THREE.Vector2[];
  samples: THREE.Vector2[];
  cumulativeLengths: number[];
  length: number;
  width: number;
}

interface TreeInstance {
  x: number;
  z: number;
  height: number;
  radius: number;
  trunkRadius: number;
  canopyTone: number;
}

export interface CityRayHit {
  point: THREE.Vector3;
  along: number;
  building: Building | null;
  chunk: BuildingChunk | null;
  target: CityDamageTarget;
}

export type CityDamageTarget =
  | { kind: "building"; building: Building }
  | { kind: "chunk"; chunk: BuildingChunk };

export interface CitySoundEvent {
  type: "building-collapse";
  position: THREE.Vector3;
  intensity: number;
}

export interface Building {
  id: number;
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  rubble: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  position: THREE.Vector3;
  halfX: number;
  halfZ: number;
  height: number;
  baseY: number;
  maxHealth: number;
  health: number;
  cold: ColdComponent;
  destroyed: boolean;
  severed: boolean;
  originalColor: THREE.Color;
  breakStage: number;
  breakAccumulator: number;
}

export class City {
  readonly group = new THREE.Group();
  readonly buildings: Building[] = [];
  private readonly burnables: Burnable[] = [];
  private readonly breakParts: BreakableBuildingPart[] = [];
  private readonly fallingTops: FallingBuildingTop[] = [];
  private readonly soundEvents: CitySoundEvent[] = [];
  private readonly trafficCars: TrafficCar[] = [];
  private readonly worldGroup = new THREE.Group();
  private readonly effectsGroup = new THREE.Group();
  private readonly breakPartGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly terrainRayPoint = new THREE.Vector3();
  private readonly layoutStrategy = new GridCityLayoutStrategy();
  private readonly roadSegmentsById = new Map<number, CityRoadSegment>();
  private readonly roadNodesById = new Map<number, CityRoadNode>();
  private layout: CityLayoutPlan | null = null;
  private terrainBounds: CityLayoutBounds = createCenteredBounds(TERRAIN_SIZE * 0.5);
  private terrainNoise: (x: number, z: number) => number = () => 0;
  private trafficRandom: () => number = Math.random;
  private generationVersion = 0;
  private totalHealth = 0;
  private readonly raycaster = new THREE.Raycaster();

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = "Caldera City";
    this.worldGroup.name = "Generated city and terrain";
    this.effectsGroup.name = "City impact debris";
    this.group.add(this.worldGroup, this.effectsGroup);
    this.scene.add(this.group);
  }

  get generationId(): number {
    return this.generationVersion;
  }

  reset(layoutOverride?: CityLayoutPlan | null, seedOverride?: number): void {
    this.generationVersion += 1;
    this.clearWorld();
    this.clearBreakParts();
    this.clearFallingTops();
    this.soundEvents.length = 0;

    const seed = seedOverride ?? this.createWorldSeed();
    const random = createSeededRandom(seed);
    this.trafficRandom = createSeededRandom(seed ^ 0x7c7f1f29);
    this.terrainNoise = createPerlinNoise(createSeededRandom(seed ^ 0xa511e9b3));
    this.layout = layoutOverride ?? this.createProceduralLayout();
    this.terrainBounds = this.layout.bounds;
    this.indexRoadGraph(this.layout);
    this.createGround(this.layout);
    this.createBuildings(random, this.layout);
    this.createTrees(random, this.layout);
    this.createTraffic(random, this.layout);
  }

  update(delta: number, coldEnvironment?: ColdEnvironment): void {
    for (const building of this.buildings) {
      if (!building.destroyed) {
        building.cold.update(delta, coldEnvironment);
        this.updateBuildingColor(building);
      }

      if (!building.destroyed && building.health < building.maxHealth) {
        const damage = 1 - building.health / building.maxHealth;
        building.mesh.rotation.z = Math.sin(performance.now() * 0.002 + building.id) * damage * 0.035;
        building.mesh.rotation.x = Math.cos(performance.now() * 0.0018 + building.id) * damage * 0.025;
      }

      if (building.rubble.visible) {
        building.rubble.rotation.y += delta * 0.08;
      }
    }

    this.updateFallingTops(delta);
    this.updateBreakParts(delta);
    this.updateTraffic(delta);
  }

  getDamageRatio(): number {
    if (this.totalHealth <= 0) {
      return 0;
    }

    const remaining = this.buildings.reduce((sum, building) => sum + building.health, 0);
    return 1 - remaining / this.totalHealth;
  }

  getAverageCold(): number {
    let standing = 0;
    let cold = 0;

    for (const building of this.buildings) {
      if (building.destroyed) {
        continue;
      }

      standing += 1;
      cold += building.cold.value;
    }

    return standing > 0 ? cold / standing : 0;
  }

  getBurnables(): readonly Burnable[] {
    return this.burnables;
  }

  getTerrainHeightAt(x: number, z: number): number {
    const low = this.terrainNoise(x * TERRAIN_LOW_FREQUENCY, z * TERRAIN_LOW_FREQUENCY);
    const detail = this.terrainNoise(x * TERRAIN_DETAIL_FREQUENCY + 31.7, z * TERRAIN_DETAIL_FREQUENCY - 18.4);
    return (low * 0.76 + detail * 0.24) * TERRAIN_AMPLITUDE + this.getMountainHeightAt(x, z);
  }

  private getMountainHeightAt(x: number, z: number): number {
    const influence = this.getMountainInfluenceAt(x, z);
    if (influence <= 0) {
      return 0;
    }

    const ridgeNoise = this.terrainNoise(x * MOUNTAIN_RIDGE_FREQUENCY - 41.2, z * MOUNTAIN_RIDGE_FREQUENCY + 27.6);
    const detailNoise = this.terrainNoise(x * MOUNTAIN_DETAIL_FREQUENCY + 73.1, z * MOUNTAIN_DETAIL_FREQUENCY - 19.9);
    const ridgeHeight =
      MOUNTAIN_MAX_HEIGHT +
      ridgeNoise * MOUNTAIN_RIDGE_AMPLITUDE +
      detailNoise * MOUNTAIN_RIDGE_AMPLITUDE * 0.34;

    return Math.max(0, ridgeHeight) * influence;
  }

  private getMountainInfluenceAt(x: number, z: number): number {
    const outsideDistance = getDistanceOutsideBounds(x, z, this.terrainBounds);
    if (outsideDistance <= MOUNTAIN_START_PADDING) {
      return 0;
    }

    const alpha = clamp((outsideDistance - MOUNTAIN_START_PADDING) / MOUNTAIN_RISE_DISTANCE, 0, 1);
    return smoothstep(alpha);
  }

  raycastTerrainDistance(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): number | null {
    const initialClearance = origin.y - this.getTerrainHeightAt(origin.x, origin.z);
    if (initialClearance <= 0) {
      return 0;
    }

    if (direction.y >= -0.001) {
      return null;
    }

    const steps = 72;
    let previousDistance = 0;
    let previousClearance = initialClearance;

    for (let step = 1; step <= steps; step += 1) {
      const distance = (maxDistance * step) / steps;
      this.terrainRayPoint.copy(origin).addScaledVector(direction, distance);
      const clearance =
        this.terrainRayPoint.y - this.getTerrainHeightAt(this.terrainRayPoint.x, this.terrainRayPoint.z);

      if (clearance <= 0) {
        const alpha = previousClearance / Math.max(0.0001, previousClearance - clearance);
        return previousDistance + (distance - previousDistance) * alpha;
      }

      previousDistance = distance;
      previousClearance = clearance;
    }

    return null;
  }

  consumeSoundEvents(): CitySoundEvent[] {
    return this.soundEvents.splice(0);
  }

  createSnapshot(): CityDamageDelta {
    return {
      buildings: this.buildings.map((building) => ({
        id: building.id,
        health: building.health,
        cold: building.cold.value,
        destroyed: building.destroyed,
        severed: building.severed,
        scaleY: building.mesh.scale.y,
        positionY: building.mesh.position.y,
      })),
    };
  }

  applySnapshot(snapshot: CityDamageDelta): void {
    for (const state of snapshot.buildings) {
      const building = this.buildings[state.id];
      if (!building) {
        continue;
      }

      building.health = clamp(state.health, 0, building.maxHealth);
      building.cold.reset(state.cold);
      building.destroyed = state.destroyed;
      building.severed = state.severed;
      building.mesh.scale.y = state.scaleY;
      building.mesh.position.y = state.positionY;
      building.mesh.visible = !state.destroyed;
      building.rubble.visible = state.destroyed;
      if (state.destroyed) {
        building.rubble.position.y = building.baseY + 1.6;
      }
      building.breakStage = Math.floor((1 - building.health / building.maxHealth) / BREAK_PART_DAMAGE_STEP);
      building.breakAccumulator = 0;
      this.updateBuildingColor(building);
    }
  }

  getNearestStandingBuilding(origin: THREE.Vector3, maxDistance = Infinity): Building | null {
    let nearest: Building | null = null;
    let nearestDistance = maxDistance;

    for (const building of this.buildings) {
      if (building.destroyed) {
        continue;
      }

      const distance = horizontalDistance(origin, building.position);
      if (distance < nearestDistance) {
        nearest = building;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  damageBuilding(building: Building, amount: number, impactPosition?: THREE.Vector3): void {
    if (building.destroyed) {
      return;
    }

    const adjustedAmount = amount * building.cold.fragilityMultiplier();
    const previousHealth = building.health;
    building.health = Math.max(0, building.health - adjustedAmount);
    const actualDamage = previousHealth - building.health;
    const healthRatio = building.health / building.maxHealth;
    const damage = 1 - healthRatio;
    this.updateBuildingColor(building);
    building.mesh.material.emissive.setRGB(damage * 0.12, damage * 0.035, 0.01);

    if (actualDamage > 0) {
      this.maybeSeverBuilding(building, impactPosition, actualDamage);

      const newBreakStage = Math.floor(damage / BREAK_PART_DAMAGE_STEP);
      const crossedStages = Math.max(0, newBreakStage - building.breakStage);
      building.breakStage = Math.max(building.breakStage, newBreakStage);
      building.breakAccumulator += actualDamage;

      const spawnThreshold = Math.max(8, building.maxHealth * 0.055);
      if (crossedStages > 0 || building.health <= 0 || building.breakAccumulator >= spawnThreshold) {
        this.spawnBreakParts(building, building.breakAccumulator, crossedStages, impactPosition);
        building.breakAccumulator = 0;
      }
    }

    if (building.health <= 0) {
      building.destroyed = true;
      building.mesh.visible = false;
      building.rubble.visible = true;
      building.rubble.position.y = building.baseY + 1.6;
      building.rubble.scale.set(1, randomRange(() => (building.id % 17) / 17, 0.34, 0.54), 1);
      this.soundEvents.push({
        type: "building-collapse",
        position: building.position.clone(),
        intensity: clamp(0.7 + building.height / 76 + actualDamage / Math.max(1, building.maxHealth), 0.85, 1.75),
      });
    }
  }

  damageTarget(target: CityDamageTarget, amount: number, impactPosition?: THREE.Vector3): void {
    if (target.kind === "building") {
      this.damageBuilding(target.building, amount, impactPosition);
      return;
    }

    this.damageBuildingChunk(target.chunk, amount, impactPosition);
  }

  warmTarget(target: CityDamageTarget, amount: number): void {
    if (target.kind === "building") {
      this.warmBuilding(target.building, amount);
    }
  }

  applyColdToBuilding(building: Building, amount: number): void {
    if (building.destroyed) {
      return;
    }

    building.cold.add(amount);
    this.updateBuildingColor(building);
  }

  warmBuilding(building: Building, amount: number): void {
    if (building.destroyed) {
      return;
    }

    building.cold.warm(amount);
    this.updateBuildingColor(building);
  }

  damageNear(position: THREE.Vector3, radius: number, amount: number): number {
    let damaged = 0;

    for (const building of this.buildings) {
      if (building.destroyed) {
        continue;
      }

      const reach = radius + Math.max(building.halfX, building.halfZ);
      if (horizontalDistance(position, building.position) <= reach) {
        this.damageBuilding(building, amount, position);
        damaged += 1;
      }
    }

    for (const chunk of [...this.fallingTops]) {
      if (chunk.destroyed) {
        continue;
      }

      const reach = radius + Math.max(chunk.halfX, chunk.halfZ);
      if (horizontalDistance(position, chunk.mesh.position) <= reach) {
        this.damageBuildingChunk(chunk, amount, position);
        damaged += 1;
      }
    }

    return damaged;
  }

  resolvePlayerBuildingCollision(position: THREE.Vector3, velocity: THREE.Vector3, sprinting: boolean): number {
    const radiusSq = PLAYER_BUILDING_RADIUS * PLAYER_BUILDING_RADIUS;
    const passes = sprinting ? 1 : PLAYER_BUILDING_COLLISION_PASSES;
    let sprintImpacts = 0;

    for (let pass = 0; pass < passes; pass += 1) {
      let resolvedAny = false;

      for (const building of this.buildings) {
        if (building.destroyed || !building.mesh.visible) {
          continue;
        }

        const currentHeight = building.height * Math.max(0.16, building.mesh.scale.y);
        if (
          position.y + PLAYER_BUILDING_VERTICAL_RADIUS < building.baseY ||
          position.y - PLAYER_BUILDING_VERTICAL_RADIUS > building.baseY + currentHeight
        ) {
          continue;
        }

        const minX = building.position.x - building.halfX;
        const maxX = building.position.x + building.halfX;
        const minZ = building.position.z - building.halfZ;
        const maxZ = building.position.z + building.halfZ;
        const closestX = clamp(position.x, minX, maxX);
        const closestZ = clamp(position.z, minZ, maxZ);
        const offsetX = position.x - closestX;
        const offsetZ = position.z - closestZ;
        const distanceSq = offsetX * offsetX + offsetZ * offsetZ;

        if (distanceSq > radiusSq) {
          continue;
        }

        if (sprinting) {
          this.damageBuilding(
            building,
            PLAYER_SPRINT_DAMAGE_BASE + velocity.length() * PLAYER_SPRINT_DAMAGE_SPEED_SCALE,
            position,
          );
          sprintImpacts += 1;
          continue;
        }

        let normalX = 0;
        let normalZ = 0;
        let penetration = 0;

        if (distanceSq > 0.0001) {
          const distance = Math.sqrt(distanceSq);
          normalX = offsetX / distance;
          normalZ = offsetZ / distance;
          penetration = PLAYER_BUILDING_RADIUS - distance + PLAYER_BUILDING_CLEARANCE;
        } else {
          const exitLeft = Math.abs(position.x - minX);
          const exitRight = Math.abs(maxX - position.x);
          const exitBack = Math.abs(position.z - minZ);
          const exitFront = Math.abs(maxZ - position.z);
          const nearestExit = Math.min(exitLeft, exitRight, exitBack, exitFront);

          if (nearestExit === exitLeft) {
            normalX = -1;
            penetration = exitLeft + PLAYER_BUILDING_RADIUS + PLAYER_BUILDING_CLEARANCE;
          } else if (nearestExit === exitRight) {
            normalX = 1;
            penetration = exitRight + PLAYER_BUILDING_RADIUS + PLAYER_BUILDING_CLEARANCE;
          } else if (nearestExit === exitBack) {
            normalZ = -1;
            penetration = exitBack + PLAYER_BUILDING_RADIUS + PLAYER_BUILDING_CLEARANCE;
          } else {
            normalZ = 1;
            penetration = exitFront + PLAYER_BUILDING_RADIUS + PLAYER_BUILDING_CLEARANCE;
          }
        }

        position.x += normalX * penetration;
        position.z += normalZ * penetration;

        const blockedSpeed = velocity.x * normalX + velocity.z * normalZ;
        if (blockedSpeed < 0) {
          velocity.x -= normalX * blockedSpeed;
          velocity.z -= normalZ * blockedSpeed;
        }

        resolvedAny = true;
      }

      if (!resolvedAny) {
        break;
      }
    }

    if (sprinting) {
      for (const chunk of [...this.fallingTops]) {
        if (chunk.destroyed || !this.isPointNearChunkVolume(position, chunk, PLAYER_BUILDING_RADIUS)) {
          continue;
        }

        this.damageBuildingChunk(
          chunk,
          PLAYER_SPRINT_DAMAGE_BASE + velocity.length() * PLAYER_SPRINT_DAMAGE_SPEED_SCALE,
          position,
        );
        sprintImpacts += 1;
      }
    }

    return sprintImpacts;
  }

  raycastBuildings(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): CityRayHit | null {
    this.raycaster.set(origin, direction);
    this.raycaster.far = maxDistance;

    const visibleMeshes = this.buildings
      .filter((building) => !building.destroyed && building.mesh.visible)
      .map((building) => building.mesh);
    for (const chunk of this.fallingTops) {
      if (!chunk.destroyed && chunk.mesh.visible) {
        visibleMeshes.push(chunk.mesh);
      }
    }

    const intersections = this.raycaster.intersectObjects(visibleMeshes, false);
    const first = intersections[0];
    if (!first) {
      return null;
    }

    const building = this.buildings.find((candidate) => candidate.mesh === first.object);
    if (building) {
      return {
        point: first.point.clone(),
        along: first.distance,
        building,
        chunk: null,
        target: { kind: "building", building },
      };
    }

    const chunk = this.fallingTops.find((candidate) => candidate.mesh === first.object);
    return chunk
      ? {
          point: first.point.clone(),
          along: first.distance,
          building: null,
          chunk,
          target: { kind: "chunk", chunk },
        }
      : null;
  }

  private updateBuildingColor(building: Building): void {
    const damage = 1 - building.health / building.maxHealth;
    building.mesh.material.color
      .copy(building.originalColor)
      .lerp(BUILDING_DAMAGE_COLOR, damage * 0.82)
      .lerp(BUILDING_COLD_COLOR, building.cold.value * 0.48);
  }

  private damageBuildingChunk(chunk: BuildingChunk, amount: number, impactPosition?: THREE.Vector3): void {
    if (chunk.destroyed) {
      return;
    }

    chunk.health = Math.max(0, chunk.health - amount);
    const damage = 1 - chunk.health / chunk.maxHealth;
    chunk.mesh.material.color.copy(chunk.color).lerp(BREAK_PART_DUST_COLOR, damage * 0.66);
    chunk.mesh.material.emissive.setRGB(damage * 0.1, damage * 0.026, 0.008);

    if (impactPosition) {
      const shove = chunk.mesh.position.clone().sub(impactPosition);
      shove.y = 0;
      if (shove.lengthSq() > 0.001) {
        shove.normalize();
        chunk.velocity.addScaledVector(shove, amount * 0.015);
        chunk.angularVelocity.x += shove.z * amount * 0.0018;
        chunk.angularVelocity.z -= shove.x * amount * 0.0018;
      }
    }

    this.updateChunkHealthBar(chunk);

    if (chunk.health > 0) {
      return;
    }

    chunk.destroyed = true;
    const floor = this.getTerrainHeightAt(chunk.mesh.position.x, chunk.mesh.position.z);
    this.breakFallingTop(chunk, floor);
    const index = this.fallingTops.indexOf(chunk);
    if (index >= 0) {
      this.fallingTops.splice(index, 1);
    }
    this.effectsGroup.remove(chunk.mesh, chunk.healthBar);
    this.disposeObject(chunk.mesh);
    this.disposeObject(chunk.healthBar);
  }

  private isPointNearChunkVolume(position: THREE.Vector3, chunk: BuildingChunk, radius: number): boolean {
    const localX = Math.abs(position.x - chunk.mesh.position.x) - chunk.halfX;
    const localY = Math.abs(position.y - chunk.mesh.position.y) - chunk.height / 2;
    const localZ = Math.abs(position.z - chunk.mesh.position.z) - chunk.halfZ;
    const outsideX = Math.max(0, localX);
    const outsideY = Math.max(0, localY);
    const outsideZ = Math.max(0, localZ);
    return outsideX * outsideX + outsideY * outsideY + outsideZ * outsideZ <= radius * radius;
  }

  private getChunkMaxHealth(
    halfX: number,
    halfZ: number,
    height: number,
    tier: FallingBuildingChunkTier,
  ): number {
    const tierScale = tier === "primary" ? 1 : 0.72;
    return Math.max(CHUNK_HEALTH_MIN, halfX * halfZ * height * CHUNK_HEALTH_VOLUME_SCALE * tierScale);
  }

  private createChunkHealthBar(): {
    group: THREE.Group;
    fill: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  } {
    const group = new THREE.Group();
    group.name = "Falling building chunk health";

    const back = new THREE.Mesh(
      new THREE.BoxGeometry(CHUNK_HEALTH_BAR_WIDTH, CHUNK_HEALTH_BAR_HEIGHT, 0.14),
      new THREE.MeshBasicMaterial({ color: 0x171b1d, transparent: true, opacity: 0.78 }),
    );
    const fill = new THREE.Mesh(
      new THREE.BoxGeometry(CHUNK_HEALTH_BAR_WIDTH, CHUNK_HEALTH_BAR_HEIGHT, 0.18),
      new THREE.MeshBasicMaterial({ color: 0x8dd06f }),
    );
    fill.position.z = -0.02;
    group.add(back, fill);

    return { group, fill };
  }

  private updateChunkHealthBar(chunk: BuildingChunk): void {
    const ratio = clamp(chunk.health / Math.max(1, chunk.maxHealth), 0, 1);
    chunk.healthBar.visible = !chunk.destroyed && chunk.mesh.visible;
    chunk.healthBar.position.set(
      chunk.mesh.position.x,
      chunk.mesh.position.y + chunk.height / 2 + CHUNK_HEALTH_BAR_RISE,
      chunk.mesh.position.z,
    );
    chunk.healthBar.rotation.set(0, 0, 0);
    chunk.healthFill.scale.x = ratio;
    chunk.healthFill.position.x = ((ratio - 1) * CHUNK_HEALTH_BAR_WIDTH) / 2;
    chunk.healthFill.material.color.setHSL(0.28 * ratio, 0.68, 0.54);
  }

  private maybeSeverBuilding(building: Building, impactPosition: THREE.Vector3 | undefined, actualDamage: number): void {
    if (building.severed || !impactPosition) {
      return;
    }

    const currentHeight = building.height * Math.max(0.16, building.mesh.scale.y);
    const impactHeight = impactPosition.y - building.baseY;
    const minimumDamage = Math.max(12, building.maxHealth * FALLING_TOP_MIN_DAMAGE_RATIO);
    const maxCutHeight = Math.min(currentHeight - FALLING_TOP_MIN_HEIGHT, FALLING_TOP_MAX_CUT_HEIGHT);

    if (
      currentHeight < FALLING_TOP_MIN_BUILDING_HEIGHT ||
      maxCutHeight < FALLING_TOP_MIN_STUMP_HEIGHT ||
      actualDamage < minimumDamage ||
      impactHeight < -PLAYER_BUILDING_VERTICAL_RADIUS ||
      impactHeight > maxCutHeight + PLAYER_BUILDING_VERTICAL_RADIUS
    ) {
      return;
    }

    const cutHeight = clamp(
      impactHeight + PLAYER_BUILDING_VERTICAL_RADIUS * 0.82,
      FALLING_TOP_MIN_STUMP_HEIGHT,
      maxCutHeight,
    );
    const topHeight = currentHeight - cutHeight;
    if (topHeight < FALLING_TOP_MIN_HEIGHT) {
      return;
    }

    this.spawnFallingTop(building, cutHeight, topHeight, impactPosition);
    building.severed = true;
    building.mesh.scale.y = cutHeight / building.height;
    building.mesh.position.y = building.baseY + cutHeight / 2;
    building.mesh.rotation.set(0, 0, 0);
  }

  private spawnFallingTop(
    building: Building,
    cutHeight: number,
    topHeight: number,
    impactPosition: THREE.Vector3,
  ): void {
    const material = building.mesh.material.clone();
    material.color.copy(building.mesh.material.color);
    material.emissive.copy(building.mesh.material.emissive);

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(building.halfX * 2, topHeight, building.halfZ * 2), material);
    mesh.position.set(building.position.x, building.baseY + cutHeight + topHeight / 2, building.position.z);
    mesh.rotation.copy(building.mesh.rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.addWindows(mesh, building.halfX * 2, topHeight, building.halfZ * 2, () => 1);

    const impactDirection = this.getImpactDirection(building, impactPosition);
    const sideways = randomRange(Math.random, 3.5, 10.5);
    const maxHealth = this.getChunkMaxHealth(building.halfX, building.halfZ, topHeight, "primary");
    const healthBar = this.createChunkHealthBar();
    const fallingTop: FallingBuildingTop = {
      mesh,
      healthBar: healthBar.group,
      healthFill: healthBar.fill,
      velocity: new THREE.Vector3(
        impactDirection.x * sideways,
        randomRange(Math.random, -4.5, 0.5),
        impactDirection.z * sideways,
      ),
      angularVelocity: new THREE.Vector3(
        randomRange(Math.random, -0.72, 0.72) + impactDirection.z * 0.44,
        randomRange(Math.random, -0.38, 0.38),
        randomRange(Math.random, -0.72, 0.72) - impactDirection.x * 0.44,
      ),
      halfX: building.halfX,
      halfZ: building.halfZ,
      height: topHeight,
      maxHealth,
      health: maxHealth,
      color: material.color.clone(),
      tier: "primary",
      destroyed: false,
    };

    this.fallingTops.push(fallingTop);
    this.effectsGroup.add(mesh, fallingTop.healthBar);
    this.updateChunkHealthBar(fallingTop);
  }

  private createWorldSeed(): number {
    const time = Date.now() >>> 0;
    const frameTime = Math.floor(performance.now() * 1000) >>> 0;
    const entropy = Math.floor(Math.random() * 0xffffffff) >>> 0;
    return (time ^ frameTime ^ entropy ^ Math.imul(this.generationVersion, 0x9e3779b1)) >>> 0;
  }

  private createProceduralLayout(): CityLayoutPlan {
    return this.layoutStrategy.generate({
      gridRadius: CITY_GRID_RADIUS,
      cellSize: BLOCK_SPACING,
      roadWidth: ROAD_WIDTH,
    });
  }

  private createGround(layout: CityLayoutPlan): void {
    const terrainFrame = getTerrainPatchFrame(layout.bounds);
    const terrainGeometry = this.createTerrainPatchGeometry(
      terrainFrame.width,
      terrainFrame.depth,
      terrainFrame.widthSegments,
      terrainFrame.depthSegments,
      0,
      terrainFrame.centerX,
      terrainFrame.centerZ,
    );
    this.applyTerrainVertexColors(terrainGeometry, terrainFrame.centerX, terrainFrame.centerZ);

    const ground = new THREE.Mesh(
      terrainGeometry,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0.015, vertexColors: true }),
    );
    ground.name = "Bounded terrain with mountain perimeter";
    ground.position.set(terrainFrame.centerX, 0, terrainFrame.centerZ);
    ground.receiveShadow = true;
    this.worldGroup.add(ground);

    const roadMaterial = new THREE.MeshStandardMaterial({
      color: 0x171d20,
      roughness: 0.82,
      metalness: 0.02,
      emissive: 0x030405,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const markingMaterial = new THREE.MeshBasicMaterial({
      color: 0xf1d766,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const edgeMarkingMaterial = new THREE.MeshBasicMaterial({
      color: 0xd7dedb,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const roadSplines = this.createRoadSplines(layout);
    const roadMesh = new THREE.Mesh(this.createRoadMaskGeometry(roadSplines), roadMaterial);
    roadMesh.receiveShadow = true;
    this.worldGroup.add(roadMesh);

    for (const spline of roadSplines) {
      const markings = new THREE.Mesh(
        this.createRoadMarkingGeometry(spline, 0, ROAD_MARKING_WIDTH, true),
        markingMaterial,
      );
      this.worldGroup.add(markings);

      for (const lateralOffset of [-spline.width * 0.42, spline.width * 0.42]) {
        const edgeMarkings = new THREE.Mesh(
          this.createRoadMarkingGeometry(spline, lateralOffset, ROAD_EDGE_MARKING_WIDTH, false),
          edgeMarkingMaterial,
        );
        this.worldGroup.add(edgeMarkings);
      }
    }

    if (layout.surfaces && layout.surfaces.length > 0) {
      this.createMappedSurfaces(layout.surfaces);
    } else {
      const parkCenterX = -46;
      const parkCenterZ = 38;
      const parkGeometry = new THREE.CircleGeometry(28, 40);
      parkGeometry.rotateX(-Math.PI / 2);
      this.projectGeometryToTerrain(parkGeometry, parkCenterX, parkCenterZ, PARK_SURFACE_OFFSET);
      const park = new THREE.Mesh(
        parkGeometry,
        new THREE.MeshStandardMaterial({ color: 0x425f49, roughness: 0.94 }),
      );
      park.position.set(parkCenterX, 0, parkCenterZ);
      park.receiveShadow = true;
      this.worldGroup.add(park);
    }
  }

  private createMappedSurfaces(surfaces: CityLayoutSurface[]): void {
    const materials: Record<CityLayoutSurface["kind"], THREE.MeshStandardMaterial> = {
      park: new THREE.MeshStandardMaterial({ color: 0x425f49, roughness: 0.94, side: THREE.DoubleSide }),
      water: new THREE.MeshStandardMaterial({
        color: 0x254f66,
        roughness: 0.48,
        metalness: 0.08,
        side: THREE.DoubleSide,
      }),
    };

    for (const surface of surfaces) {
      const geometry = this.createMappedSurfaceGeometry(surface.vertices);
      const mesh = new THREE.Mesh(geometry, materials[surface.kind]);
      mesh.name = surface.kind === "water" ? "Mapped water" : "Mapped park";
      mesh.receiveShadow = true;
      this.worldGroup.add(mesh);
    }
  }

  private createMappedSurfaceGeometry(vertices: THREE.Vector2[]): THREE.ShapeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(vertices[0].x, vertices[0].y);
    for (let index = 1; index < vertices.length; index += 1) {
      shape.lineTo(vertices[index].x, vertices[index].y);
    }
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(Math.PI / 2);
    this.projectGeometryToTerrain(geometry, 0, 0, PARK_SURFACE_OFFSET);
    return geometry;
  }

  private createBuildings(random: () => number, layout: CityLayoutPlan): void {
    let id = 0;

    if (layout.buildingSites && layout.buildingSites.length > 0) {
      for (const site of layout.buildingSites) {
        const height = site.height ?? randomRange(random, 22, 74);
        this.createBuilding(id, site.center.x, site.center.y, site.width, site.depth, height, random);
        id += 1;
      }
      return;
    }

    for (const cell of layout.cells) {
      if (this.isCivicCell(cell)) {
        continue;
      }

      const buildingCount = random() > 0.78 ? 3 : random() > 0.42 ? 2 : 1;
      const sites: BuildingSite[] = [];

      for (let item = 0; item < buildingCount; item += 1) {
        const width = randomRange(random, 8, 16);
        const depth = randomRange(random, 8, 17);
        const site = this.pickBuildingSite(cell, width, depth, random, sites);
        if (!site) {
          continue;
        }

        const distanceFromCenter = cell.center.length() / BLOCK_SPACING;
        const height =
          randomRange(random, 20, 66) + Math.max(0, 4 - distanceFromCenter) * randomRange(random, 5, 13);
        this.createBuilding(id, site.x, site.z, width, depth, height, random);
        sites.push(site);
        id += 1;
      }
    }
  }

  private createBuilding(
    id: number,
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    random: () => number,
  ): void {
    const baseY = this.getTerrainHeightAt(x, z);
    const color = new THREE.Color().setHSL(
      randomRange(random, 0.53, 0.61),
      randomRange(random, 0.1, 0.22),
      randomRange(random, 0.34, 0.5),
    );
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.68, metalness: 0.12 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, baseY + height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const rubble = new THREE.Mesh(
      new THREE.BoxGeometry(width * 1.1, 3.2, depth * 1.1),
      new THREE.MeshStandardMaterial({ color: 0x343230, roughness: 0.91 }),
    );
    rubble.position.set(x, baseY + 1.6, z);
    rubble.visible = false;
    rubble.castShadow = true;
    rubble.receiveShadow = true;

    const building: Building = {
      id,
      mesh,
      rubble,
      position: new THREE.Vector3(x, baseY, z),
      halfX: width / 2,
      halfZ: depth / 2,
      height,
      baseY,
      maxHealth: 70 + height * 2.6 + width * depth * 0.12,
      health: 0,
      cold: new ColdComponent(0.045),
      destroyed: false,
      severed: false,
      originalColor: color.clone(),
      breakStage: 0,
      breakAccumulator: 0,
    };

    building.health = building.maxHealth;
    this.totalHealth += building.maxHealth;
    this.buildings.push(building);
    this.burnables.push(this.createBuildingBurnable(building, width, depth));
    this.worldGroup.add(mesh, rubble);
    this.addWindows(mesh, width, height, depth, random);
  }

  private addWindows(mesh: THREE.Mesh, width: number, height: number, depth: number, random: () => number): void {
    if (height < 28 || random() < 0.34) {
      return;
    }

    const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xe1c66e, transparent: true, opacity: 0.48 });
    const rows = Math.min(8, Math.floor(height / 8));
    const windowGroup = new THREE.Group();

    for (let row = 0; row < rows; row += 1) {
      const y = -height / 2 + 7 + row * 7;
      for (let side = 0; side < 2; side += 1) {
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.72, 0.7), windowMaterial);
        pane.position.set(0, y, side === 0 ? -depth / 2 - 0.015 : depth / 2 + 0.015);
        pane.rotation.y = side === 0 ? Math.PI : 0;
        windowGroup.add(pane);
      }
    }

    mesh.add(windowGroup);
  }

  private isCivicCell(cell: CityLayoutCell): boolean {
    const isCenterPlaza = cell.center.length() < BLOCK_SPACING * 0.72;
    const isParkCell = Math.abs(cell.center.x + BLOCK_SPACING) < 0.001 && Math.abs(cell.center.y - BLOCK_SPACING) < 0.001;
    return isCenterPlaza || isParkCell;
  }

  private pickBuildingSite(
    cell: CityLayoutCell,
    width: number,
    depth: number,
    random: () => number,
    existingSites: BuildingSite[],
  ): BuildingSite | null {
    const bounds = getCellBounds(cell);
    const halfX = width / 2;
    const halfZ = depth / 2;
    const minX = bounds.minX + ROAD_WIDTH * 0.5 + BUILDING_ROAD_SETBACK + halfX;
    const maxX = bounds.maxX - ROAD_WIDTH * 0.5 - BUILDING_ROAD_SETBACK - halfX;
    const minZ = bounds.minZ + ROAD_WIDTH * 0.5 + BUILDING_ROAD_SETBACK + halfZ;
    const maxZ = bounds.maxZ - ROAD_WIDTH * 0.5 - BUILDING_ROAD_SETBACK - halfZ;

    if (minX > maxX || minZ > maxZ) {
      return null;
    }

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const x = randomRange(random, minX, maxX);
      const z = randomRange(random, minZ, maxZ);

      if (
        !pointInPolygon(x, z, cell.vertices) ||
        distanceToPolygonEdges(x, z, cell.vertices) < ROAD_WIDTH * 0.5 + BUILDING_ROAD_SETBACK
      ) {
        continue;
      }

      const overlaps = existingSites.some(
        (site) =>
          Math.abs(site.x - x) < site.halfX + halfX + BUILDING_MIN_GAP &&
          Math.abs(site.z - z) < site.halfZ + halfZ + BUILDING_MIN_GAP,
      );
      if (!overlaps) {
        return { x, z, halfX, halfZ };
      }
    }

    if (existingSites.length === 0) {
      const x = clamp(cell.center.x, minX, maxX);
      const z = clamp(cell.center.y, minZ, maxZ);
      return { x, z, halfX, halfZ };
    }

    return null;
  }

  private indexRoadGraph(layout: CityLayoutPlan): void {
    this.roadSegmentsById.clear();
    this.roadNodesById.clear();

    for (const road of layout.roads) {
      this.roadSegmentsById.set(road.id, road);
    }

    for (const node of layout.nodes) {
      this.roadNodesById.set(node.id, node);
    }
  }

  private createTraffic(random: () => number, layout: CityLayoutPlan): void {
    this.trafficCars.length = 0;
    const roads = layout.roads.filter((road) => road.length > 16);
    const count = Math.min(TRAFFIC_CAR_COUNT, roads.length);

    for (let index = 0; index < count; index += 1) {
      const road = roads[Math.floor(random() * roads.length)];
      const forward = random() > 0.5;
      const group = this.createCarMesh(random);
      const car: TrafficCar = {
        group,
        segmentId: road.id,
        fromNodeId: forward ? road.startNodeId : road.endNodeId,
        toNodeId: forward ? road.endNodeId : road.startNodeId,
        progress: random(),
        speed: randomRange(random, 8.5, 16.5),
        laneOffset:
          (random() > 0.5 ? 1 : -1) * randomRange(random, TRAFFIC_LANE_MIN_OFFSET, TRAFFIC_LANE_MAX_OFFSET),
      };

      this.trafficCars.push(car);
      this.worldGroup.add(group);
      this.placeTrafficCar(car);
    }
  }

  private createCarMesh(random: () => number): THREE.Group {
    const car = new THREE.Group();
    car.name = "Traffic car";

    const bodyColor = new THREE.Color().setHSL(randomRange(random, 0.0, 0.12), randomRange(random, 0.52, 0.82), 0.48);
    if (random() > 0.5) {
      bodyColor.setHSL(randomRange(random, 0.55, 0.66), randomRange(random, 0.42, 0.72), 0.5);
    }

    const bodyMaterial = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.52, metalness: 0.18 });
    const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x17252e, roughness: 0.28, metalness: 0.08 });
    const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x151719, roughness: 0.82 });
    const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xf3d27b });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.78, 3.8), bodyMaterial);
    body.position.y = 0.58;
    body.castShadow = true;
    body.receiveShadow = true;
    car.add(body);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.62, 1.55), glassMaterial);
    cabin.position.set(0, 1.15, -0.25);
    cabin.castShadow = true;
    car.add(cabin);

    for (const x of [-1.02, 1.02]) {
      for (const z of [-1.18, 1.18]) {
        const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.46, 0.72), tireMaterial);
        wheel.position.set(x, 0.28, z);
        wheel.castShadow = true;
        car.add(wheel);
      }
    }

    for (const x of [-0.52, 0.52]) {
      const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.08), lightMaterial);
      headlight.position.set(x, 0.62, -1.95);
      car.add(headlight);
    }

    return car;
  }

  private updateTraffic(delta: number): void {
    for (const car of this.trafficCars) {
      const segment = this.roadSegmentsById.get(car.segmentId);
      if (!segment || segment.length <= 0.001) {
        continue;
      }

      car.progress += (car.speed * delta) / segment.length;
      let transitions = 0;
      while (car.progress >= 1 && transitions < 4) {
        car.progress -= 1;
        this.advanceTrafficCar(car);
        transitions += 1;
      }

      this.placeTrafficCar(car);
    }
  }

  private advanceTrafficCar(car: TrafficCar): void {
    const reachedNodeId = car.toNodeId;
    const node = this.roadNodesById.get(reachedNodeId);
    if (!node || node.roadIds.length === 0) {
      const currentRoad = this.roadSegmentsById.get(car.segmentId);
      if (currentRoad) {
        car.fromNodeId = reachedNodeId;
        car.toNodeId = currentRoad.startNodeId === reachedNodeId ? currentRoad.endNodeId : currentRoad.startNodeId;
      }
      return;
    }

    const forwardOptions = node.roadIds.filter((roadId) => roadId !== car.segmentId);
    const options = forwardOptions.length > 0 ? forwardOptions : node.roadIds;
    const nextRoadId = options[Math.floor(this.trafficRandom() * options.length)];
    const nextRoad = this.roadSegmentsById.get(nextRoadId);
    if (!nextRoad) {
      return;
    }

    car.segmentId = nextRoad.id;
    car.fromNodeId = reachedNodeId;
    car.toNodeId = nextRoad.startNodeId === reachedNodeId ? nextRoad.endNodeId : nextRoad.startNodeId;
  }

  private placeTrafficCar(car: TrafficCar): void {
    const from = this.roadNodesById.get(car.fromNodeId);
    const to = this.roadNodesById.get(car.toNodeId);
    if (!from || !to) {
      car.group.visible = false;
      return;
    }

    const dx = to.position.x - from.position.x;
    const dz = to.position.y - from.position.y;
    const length = Math.hypot(dx, dz);
    if (length <= 0.001) {
      car.group.visible = false;
      return;
    }

    const directionX = dx / length;
    const directionZ = dz / length;
    const laneX = -directionZ * car.laneOffset;
    const laneZ = directionX * car.laneOffset;
    const x = from.position.x + dx * car.progress + laneX;
    const z = from.position.y + dz * car.progress + laneZ;

    car.group.visible = true;
    car.group.position.set(x, this.getTerrainHeightAt(x, z) + ROAD_SURFACE_OFFSET + TRAFFIC_SURFACE_OFFSET, z);
    car.group.rotation.set(0, Math.atan2(directionX, directionZ), 0);
  }

  private createBuildingBurnable(building: Building, width: number, depth: number): Burnable {
    return {
      id: `building:${building.id}`,
      position: building.position,
      bounds: {
        center: building.mesh.position,
        halfExtents: new THREE.Vector3(building.halfX, building.height / 2, building.halfZ),
        radius: Math.hypot(building.halfX, building.halfZ),
      },
      fuel: 16 + building.height * 0.45 + width * depth * 0.018,
      ignitionThreshold: 0.85,
      spreadRadius: 44 + Math.max(width, depth) * 0.55,
      canBurn: () => !building.destroyed && building.health > 0,
      onIgnite: () => {
        if (!building.destroyed) {
          building.mesh.material.emissive.setRGB(0.34, 0.08, 0.01);
        }
      },
      onBurn: (delta, intensity) => {
        if (building.destroyed) {
          return;
        }

        const burnDamage = (4.5 + building.height * 0.045) * intensity * delta;
        this.damageBuilding(building, burnDamage, building.mesh.position);
        if (!building.destroyed) {
          const damage = 1 - building.health / building.maxHealth;
          building.mesh.material.emissive.setRGB(
            Math.max(damage * 0.12, intensity * 0.26),
            Math.max(damage * 0.035, intensity * 0.08),
            0.01,
          );
        }
      },
      onExtinguish: () => {
        if (!building.destroyed) {
          const damage = 1 - building.health / building.maxHealth;
          building.mesh.material.emissive.setRGB(damage * 0.12, damage * 0.035, 0.01);
        }
      },
    };
  }

  private createTrees(random: () => number, layout: CityLayoutPlan): void {
    const roadSplines = this.createRoadSplines(layout);
    const trees: TreeInstance[] = [];
    const treeBounds = expandBounds(layout.bounds, MOUNTAIN_START_PADDING * 0.74);

    this.seedParkTrees(random, layout, roadSplines, trees);

    for (let attempt = 0; attempt < TREE_ATTEMPTS && trees.length < TREE_COUNT; attempt += 1) {
      const position = this.pickTreePosition(random, roadSplines, treeBounds);
      if (!position) {
        continue;
      }

      this.addTreeInstance(trees, random, position.x, position.z, roadSplines);
    }

    if (trees.length === 0) {
      return;
    }

    const trunkGeometry = new THREE.CylinderGeometry(1, 1.25, 1, 6);
    const canopyGeometry = new THREE.ConeGeometry(1, 1, 7);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4d3625, roughness: 0.88 });
    const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x2f6940, roughness: 0.92 });
    const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, trees.length);
    const canopyMesh = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, trees.length);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();

    trunkMesh.name = "Procedural tree trunks";
    canopyMesh.name = "Procedural tree canopies";
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;
    canopyMesh.castShadow = true;
    canopyMesh.receiveShadow = true;
    trunkMesh.frustumCulled = false;
    canopyMesh.frustumCulled = false;

    for (let index = 0; index < trees.length; index += 1) {
      const tree = trees[index];
      const terrainY = this.getTerrainHeightAt(tree.x, tree.z) + TREE_SURFACE_OFFSET;
      const trunkHeight = tree.height * 0.38;
      const canopyHeight = tree.height * 0.72;
      const yaw = random() * Math.PI * 2;

      quaternion.setFromEuler(new THREE.Euler(0, yaw, 0));
      position.set(tree.x, terrainY + trunkHeight / 2, tree.z);
      scale.set(tree.trunkRadius, trunkHeight, tree.trunkRadius);
      matrix.compose(position, quaternion, scale);
      trunkMesh.setMatrixAt(index, matrix);

      position.set(tree.x, terrainY + trunkHeight + canopyHeight * 0.42, tree.z);
      scale.set(tree.radius, canopyHeight, tree.radius);
      matrix.compose(position, quaternion, scale);
      canopyMesh.setMatrixAt(index, matrix);
      canopyMesh.setColorAt(index, color.setHSL(0.28 + tree.canopyTone * 0.08, 0.42 + tree.canopyTone * 0.16, 0.23 + tree.canopyTone * 0.08));
    }

    trunkMesh.instanceMatrix.needsUpdate = true;
    canopyMesh.instanceMatrix.needsUpdate = true;
    if (canopyMesh.instanceColor) {
      canopyMesh.instanceColor.needsUpdate = true;
    }
    trunkMesh.computeBoundingSphere();
    canopyMesh.computeBoundingSphere();

    this.worldGroup.add(trunkMesh, canopyMesh);
  }

  private seedParkTrees(
    random: () => number,
    layout: CityLayoutPlan,
    roadSplines: RoadSpline[],
    trees: TreeInstance[],
  ): void {
    const parks = layout.surfaces?.filter((surface) => surface.kind === "park") ?? [];
    if (parks.length > 0) {
      for (const park of parks) {
        const targetCount = clamp(Math.ceil(polygonArea(park.vertices) / 210), 10, 42);
        this.seedTreesInPolygon(random, park.vertices, targetCount, roadSplines, trees, -0.3);
      }
      return;
    }

    for (const cell of layout.cells) {
      if (!this.isCivicCell(cell)) {
        continue;
      }

      const isCenterPlaza = cell.center.length() < BLOCK_SPACING * 0.72;
      this.seedTreesInPolygon(
        random,
        cell.vertices,
        isCenterPlaza ? 14 : 46,
        roadSplines,
        trees,
        isCenterPlaza ? -0.6 : 0,
      );
    }
  }

  private seedTreesInPolygon(
    random: () => number,
    vertices: THREE.Vector2[],
    targetCount: number,
    roadSplines: RoadSpline[],
    trees: TreeInstance[],
    sizeBias: number,
  ): void {
    const bounds = getPolygonBounds(vertices);
    let planted = 0;
    const maxAttempts = targetCount * TREE_GROVE_ATTEMPTS_PER_TREE;

    for (let attempt = 0; attempt < maxAttempts && planted < targetCount && trees.length < TREE_COUNT; attempt += 1) {
      const x = randomRange(random, bounds.minX, bounds.maxX);
      const z = randomRange(random, bounds.minZ, bounds.maxZ);
      if (!pointInPolygon(x, z, vertices) || distanceToPolygonEdges(x, z, vertices) < TREE_PARK_EDGE_CLEARANCE) {
        continue;
      }

      if (this.addTreeInstance(trees, random, x, z, roadSplines, sizeBias)) {
        planted += 1;
      }
    }
  }

  private addTreeInstance(
    trees: TreeInstance[],
    random: () => number,
    x: number,
    z: number,
    roadSplines: RoadSpline[],
    sizeBias = 0,
  ): boolean {
    if (this.getRoadSignedDistance(x, z, roadSplines) < TREE_ROAD_CLEARANCE) {
      return false;
    }

    for (const building of this.buildings) {
      if (
        Math.abs(building.position.x - x) < building.halfX + TREE_BUILDING_CLEARANCE &&
        Math.abs(building.position.z - z) < building.halfZ + TREE_BUILDING_CLEARANCE
      ) {
        return false;
      }
    }

    for (const tree of trees) {
      if (Math.hypot(tree.x - x, tree.z - z) < tree.radius + TREE_MIN_SPACING) {
        return false;
      }
    }

    const cityDistance = Math.hypot(x, z);
    const outskirtsBias = clamp((cityDistance - BLOCK_SPACING * 2.6) / (TERRAIN_SIZE * 0.28), 0, 1);
    const height = randomRange(random, 4.8 + sizeBias, 8.6 + outskirtsBias * 2.8 + sizeBias);
    trees.push({
      x,
      z,
      height,
      radius: randomRange(random, 1.45, 2.8 + outskirtsBias * 0.8 + sizeBias * 0.25),
      trunkRadius: randomRange(random, 0.18, 0.34),
      canopyTone: random(),
    });
    return true;
  }

  private pickTreePosition(
    random: () => number,
    roadSplines: RoadSpline[],
    treeBounds: CityLayoutBounds,
  ): { x: number; z: number } | null {
    const x = randomRange(random, treeBounds.minX, treeBounds.maxX);
    const z = randomRange(random, treeBounds.minZ, treeBounds.maxZ);

    if (this.getRoadSignedDistance(x, z, roadSplines) < TREE_ROAD_CLEARANCE) {
      return null;
    }

    return { x, z };
  }

  private spawnBreakParts(
    building: Building,
    damageAmount: number,
    crossedStages: number,
    impactPosition?: THREE.Vector3,
  ): void {
    const damageRatio = damageAmount / building.maxHealth;
    const destroyBonus = building.health <= 0 ? 5 : 0;
    const count = Math.min(11, Math.max(1, Math.ceil(damageRatio * 18) + crossedStages * 2 + destroyBonus));
    const sourceDirection = this.getImpactDirection(building, impactPosition);
    const useXAxis = Math.abs(sourceDirection.x) * building.halfZ > Math.abs(sourceDirection.z) * building.halfX;
    const currentHeight = building.height * Math.max(0.2, building.mesh.scale.y);

    for (let index = 0; index < count; index += 1) {
      const part = this.getBreakPart();
      const sideSign = useXAxis ? Math.sign(sourceDirection.x || 1) : Math.sign(sourceDirection.z || 1);
      const normal = useXAxis ? new THREE.Vector3(sideSign, 0, randomRange(Math.random, -0.18, 0.18)) : new THREE.Vector3(randomRange(Math.random, -0.18, 0.18), 0, sideSign);
      normal.normalize();

      const x = useXAxis
        ? building.position.x + sideSign * (building.halfX + 0.35)
        : building.position.x + randomRange(Math.random, -building.halfX * 0.82, building.halfX * 0.82);
      const z = useXAxis
        ? building.position.z + randomRange(Math.random, -building.halfZ * 0.82, building.halfZ * 0.82)
        : building.position.z + sideSign * (building.halfZ + 0.35);
      const y =
        building.baseY +
        randomRange(Math.random, currentHeight * 0.24, Math.max(currentHeight * 0.92, currentHeight * 0.24 + 2));

      part.mesh.visible = true;
      part.mesh.position.set(x, y, z);
      part.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      part.mesh.scale.set(
        randomRange(Math.random, 0.75, 2.4),
        randomRange(Math.random, 0.6, 3.6),
        randomRange(Math.random, 0.7, 2.5),
      );
      part.mesh.material.color.copy(building.originalColor).lerp(BREAK_PART_DUST_COLOR, randomRange(Math.random, 0.38, 0.74));
      part.mesh.material.opacity = 1;

      const burst = 18 + damageRatio * 28 + crossedStages * 3 + destroyBonus * 1.4;
      part.velocity
        .copy(normal)
        .multiplyScalar(randomRange(Math.random, burst * 0.72, burst * 1.25))
        .add(new THREE.Vector3(randomRange(Math.random, -7, 7), randomRange(Math.random, 16, 34), randomRange(Math.random, -7, 7)));
      part.angularVelocity.set(
        randomRange(Math.random, -4.8, 4.8),
        randomRange(Math.random, -5.6, 5.6),
        randomRange(Math.random, -4.8, 4.8),
      );
      part.life = randomRange(Math.random, 1.8, 3.2) + destroyBonus * 0.08;
      part.maxLife = part.life;
    }
  }

  private getImpactDirection(building: Building, impactPosition?: THREE.Vector3): THREE.Vector3 {
    if (impactPosition) {
      const direction = new THREE.Vector3(impactPosition.x - building.position.x, 0, impactPosition.z - building.position.z);
      if (direction.lengthSq() > 0.001) {
        return direction.normalize();
      }
    }

    const angle = Math.random() * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  }

  private getBreakPart(): BreakableBuildingPart {
    const available = this.breakParts.find((part) => part.life <= 0);
    if (available) {
      return available;
    }

    if (this.breakParts.length < MAX_BREAK_PARTS) {
      const material = new THREE.MeshStandardMaterial({
        color: 0x4b4640,
        roughness: 0.86,
        metalness: 0.03,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(this.breakPartGeometry, material);
      mesh.visible = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const part: BreakableBuildingPart = {
        mesh,
        velocity: new THREE.Vector3(),
        angularVelocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
      };
      this.breakParts.push(part);
      this.effectsGroup.add(mesh);
      return part;
    }

    return this.breakParts.reduce((oldest, part) => (part.life < oldest.life ? part : oldest), this.breakParts[0]);
  }

  private updateFallingTops(delta: number): void {
    for (let index = this.fallingTops.length - 1; index >= 0; index -= 1) {
      const top = this.fallingTops[index];
      if (top.destroyed) {
        continue;
      }

      top.velocity.y -= FALLING_TOP_GRAVITY * delta;
      top.velocity.multiplyScalar(Math.max(0, 1 - delta * FALLING_TOP_AIR_DRAG));
      top.mesh.position.addScaledVector(top.velocity, delta);
      top.mesh.rotation.x += top.angularVelocity.x * delta;
      top.mesh.rotation.y += top.angularVelocity.y * delta;
      top.mesh.rotation.z += top.angularVelocity.z * delta;
      this.updateChunkHealthBar(top);

      const floor = this.getTerrainHeightAt(top.mesh.position.x, top.mesh.position.z);
      if (top.mesh.position.y - top.height / 2 <= floor + 0.35) {
        top.mesh.position.y = floor + top.height / 2;
        if (top.tier === "primary" && this.canSpawnMediumChunks(top)) {
          this.spawnMediumFallingChunks(top, floor);
        } else {
          this.breakFallingTop(top, floor);
        }
        this.fallingTops.splice(index, 1);
        this.effectsGroup.remove(top.mesh, top.healthBar);
        this.disposeObject(top.mesh);
        this.disposeObject(top.healthBar);
      }
    }
  }

  private canSpawnMediumChunks(top: FallingBuildingTop): boolean {
    return (
      top.height >= FALLING_MEDIUM_CHUNK_MIN_HEIGHT * 2.4 &&
      top.halfX >= FALLING_MEDIUM_CHUNK_MIN_HALF_EXTENT * 2 &&
      top.halfZ >= FALLING_MEDIUM_CHUNK_MIN_HALF_EXTENT * 2
    );
  }

  private spawnMediumFallingChunks(top: FallingBuildingTop, floor: number): void {
    const volumeFactor = (top.halfX * top.halfZ * top.height) / 130;
    const count = Math.min(
      FALLING_MEDIUM_CHUNK_MAX_COUNT,
      Math.max(FALLING_MEDIUM_CHUNK_MIN_COUNT, Math.ceil(volumeFactor)),
    );

    for (let index = 0; index < count; index += 1) {
      const widthMax = Math.max(FALLING_MEDIUM_CHUNK_MIN_HALF_EXTENT * 2.2, top.halfX * 1.08);
      const depthMax = Math.max(FALLING_MEDIUM_CHUNK_MIN_HALF_EXTENT * 2.2, top.halfZ * 1.08);
      const heightMax = Math.max(FALLING_MEDIUM_CHUNK_MIN_HEIGHT * 1.3, top.height * 0.36);
      const width = randomRange(
        Math.random,
        Math.min(widthMax, Math.max(FALLING_MEDIUM_CHUNK_MIN_HALF_EXTENT * 2, top.halfX * 0.52)),
        widthMax,
      );
      const depth = randomRange(
        Math.random,
        Math.min(depthMax, Math.max(FALLING_MEDIUM_CHUNK_MIN_HALF_EXTENT * 2, top.halfZ * 0.52)),
        depthMax,
      );
      const height = randomRange(
        Math.random,
        Math.min(heightMax, Math.max(FALLING_MEDIUM_CHUNK_MIN_HEIGHT, top.height * 0.16)),
        heightMax,
      );
      const scatterX = randomRange(Math.random, -top.halfX * 0.78, top.halfX * 0.78);
      const scatterZ = randomRange(Math.random, -top.halfZ * 0.78, top.halfZ * 0.78);
      const angle = Math.atan2(scatterZ, scatterX) + randomRange(Math.random, -0.55, 0.55);
      const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const chunkFloor = this.getTerrainHeightAt(top.mesh.position.x + scatterX, top.mesh.position.z + scatterZ);
      const material = top.mesh.material.clone();
      material.color.copy(top.color).lerp(BREAK_PART_DUST_COLOR, randomRange(Math.random, 0.12, 0.36));
      material.emissive.multiplyScalar(0.55);

      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      mesh.position.set(
        top.mesh.position.x + scatterX,
        Math.max(floor, chunkFloor) + height / 2 + randomRange(Math.random, 1.2, Math.max(2.4, top.height * 0.18)),
        top.mesh.position.z + scatterZ,
      );
      mesh.rotation.copy(top.mesh.rotation);
      mesh.rotation.x += randomRange(Math.random, -0.42, 0.42);
      mesh.rotation.y += randomRange(Math.random, -0.72, 0.72);
      mesh.rotation.z += randomRange(Math.random, -0.42, 0.42);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const maxHealth = this.getChunkMaxHealth(width / 2, depth / 2, height, "medium");
      const healthBar = this.createChunkHealthBar();
      const chunk: FallingBuildingTop = {
        mesh,
        healthBar: healthBar.group,
        healthFill: healthBar.fill,
        velocity: top.velocity
          .clone()
          .multiplyScalar(0.22)
          .addScaledVector(radial, randomRange(Math.random, 10, 26))
          .add(new THREE.Vector3(0, randomRange(Math.random, 12, 30), 0)),
        angularVelocity: new THREE.Vector3(
          randomRange(Math.random, -2.1, 2.1),
          randomRange(Math.random, -2.6, 2.6),
          randomRange(Math.random, -2.1, 2.1),
        ),
        halfX: width / 2,
        halfZ: depth / 2,
        height,
        maxHealth,
        health: maxHealth,
        color: material.color.clone(),
        tier: "medium",
        destroyed: false,
      };
      this.fallingTops.push(chunk);
      this.effectsGroup.add(mesh, chunk.healthBar);
      this.updateChunkHealthBar(chunk);
    }

    this.soundEvents.push({
      type: "building-collapse",
      position: top.mesh.position.clone(),
      intensity: clamp(0.92 + top.height / 82 + top.velocity.length() / 86, 0.95, 1.8),
    });
  }

  private breakFallingTop(top: FallingBuildingTop, floor: number): void {
    const count =
      top.tier === "medium"
        ? Math.min(14, Math.max(5, Math.ceil(top.height * 1.2 + top.halfX + top.halfZ)))
        : Math.min(FALLING_TOP_IMPACT_PARTS + Math.ceil(top.height / 8), Math.max(10, Math.floor(top.height * 0.9)));
    const minPartExtent = top.tier === "medium" ? 0.45 : 1.1;
    const maxPartX = Math.max(minPartExtent, Math.min(top.tier === "medium" ? 2.2 : 4.2, top.halfX * 0.7));
    const maxPartY = Math.max(0.55, Math.min(top.tier === "medium" ? 2.6 : 5.4, top.height * 0.2));
    const maxPartZ = Math.max(minPartExtent, Math.min(top.tier === "medium" ? 2.2 : 4.2, top.halfZ * 0.7));

    for (let index = 0; index < count; index += 1) {
      const part = this.getBreakPart();
      const angle = Math.random() * Math.PI * 2;
      const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const scatterX = randomRange(Math.random, -top.halfX * 0.92, top.halfX * 0.92);
      const scatterZ = randomRange(Math.random, -top.halfZ * 0.92, top.halfZ * 0.92);

      part.mesh.visible = true;
      part.mesh.position.set(
        top.mesh.position.x + scatterX,
        floor + randomRange(Math.random, 0.8, Math.max(4.2, top.height * 0.42)),
        top.mesh.position.z + scatterZ,
      );
      part.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      part.mesh.scale.set(
        randomRange(Math.random, Math.min(minPartExtent, maxPartX), maxPartX),
        randomRange(Math.random, Math.min(0.55, maxPartY), maxPartY),
        randomRange(Math.random, Math.min(minPartExtent, maxPartZ), maxPartZ),
      );
      part.mesh.material.color.copy(top.color).lerp(BREAK_PART_DUST_COLOR, randomRange(Math.random, 0.42, 0.82));
      part.mesh.material.opacity = 1;

      part.velocity
        .copy(radial)
        .multiplyScalar(randomRange(Math.random, top.tier === "medium" ? 7 : 12, top.tier === "medium" ? 22 : 32))
        .add(
          new THREE.Vector3(
            top.velocity.x * 0.18,
            randomRange(Math.random, top.tier === "medium" ? 8 : 12, top.tier === "medium" ? 24 : 32),
            top.velocity.z * 0.18,
          ),
        );
      part.angularVelocity.set(
        randomRange(Math.random, -5.8, 5.8),
        randomRange(Math.random, -6.6, 6.6),
        randomRange(Math.random, -5.8, 5.8),
      );
      part.life = randomRange(Math.random, 2.4, 4.2);
      part.maxLife = part.life;
    }

    this.soundEvents.push({
      type: "building-collapse",
      position: top.mesh.position.clone(),
      intensity: clamp(0.68 + top.height / 70 + top.velocity.length() / 82, 0.74, top.tier === "medium" ? 1.24 : 1.95),
    });
  }

  private updateBreakParts(delta: number): void {
    for (const part of this.breakParts) {
      if (part.life <= 0) {
        continue;
      }

      part.life = Math.max(0, part.life - delta);
      if (part.life <= 0) {
        part.mesh.visible = false;
        part.mesh.material.opacity = 0;
        continue;
      }

      part.velocity.y -= BREAK_PART_GRAVITY * delta;
      part.velocity.multiplyScalar(Math.max(0, 1 - delta * 0.45));
      part.mesh.position.addScaledVector(part.velocity, delta);
      part.mesh.rotation.x += part.angularVelocity.x * delta;
      part.mesh.rotation.y += part.angularVelocity.y * delta;
      part.mesh.rotation.z += part.angularVelocity.z * delta;

      const floor = this.getTerrainHeightAt(part.mesh.position.x, part.mesh.position.z) + Math.max(0.22, part.mesh.scale.y * 0.42);
      if (part.mesh.position.y < floor) {
        part.mesh.position.y = floor;
        if (part.velocity.y < 0) {
          part.velocity.y *= -0.22;
          part.velocity.x *= 0.62;
          part.velocity.z *= 0.62;
          part.angularVelocity.multiplyScalar(0.72);
        }
      }

      part.mesh.material.opacity = Math.min(1, part.life / Math.min(0.75, part.maxLife));
    }
  }

  private clearBreakParts(): void {
    for (const part of this.breakParts) {
      part.life = 0;
      part.maxLife = 0;
      part.mesh.visible = false;
      part.mesh.material.opacity = 0;
      part.velocity.set(0, 0, 0);
      part.angularVelocity.set(0, 0, 0);
    }
  }

  private clearFallingTops(): void {
    for (const top of this.fallingTops) {
      this.effectsGroup.remove(top.mesh, top.healthBar);
      this.disposeObject(top.mesh);
      this.disposeObject(top.healthBar);
    }
    this.fallingTops.length = 0;
  }

  private clearWorld(): void {
    while (this.worldGroup.children.length > 0) {
      const child = this.worldGroup.children[0];
      this.worldGroup.remove(child);
      this.disposeObject(child);
    }

    this.buildings.length = 0;
    this.burnables.length = 0;
    this.trafficCars.length = 0;
    this.roadSegmentsById.clear();
    this.roadNodesById.clear();
    this.layout = null;
    this.totalHealth = 0;
  }

  private disposeObject(object: THREE.Object3D): void {
    for (const child of [...object.children]) {
      object.remove(child);
      this.disposeObject(child);
    }

    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) {
        for (const entry of material) {
          entry.dispose();
        }
      } else {
        material.dispose();
      }
    }
  }

  private createTerrainPatchGeometry(
    width: number,
    depth: number,
    widthSegments: number,
    depthSegments: number,
    yOffset: number,
    centerX = 0,
    centerZ = 0,
  ): THREE.PlaneGeometry {
    const geometry = new THREE.PlaneGeometry(width, depth, widthSegments, depthSegments);
    geometry.rotateX(-Math.PI / 2);
    this.projectGeometryToTerrain(geometry, centerX, centerZ, yOffset);
    return geometry;
  }

  private applyTerrainVertexColors(
    geometry: THREE.BufferGeometry,
    centerX: number,
    centerZ: number,
  ): void {
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colors: number[] = [];
    const baseColor = new THREE.Color(0x314842);
    const slopeColor = new THREE.Color(0x5b6259);
    const snowColor = new THREE.Color(0xc5d4d0);
    const color = new THREE.Color();

    for (let index = 0; index < positions.count; index += 1) {
      const worldX = centerX + positions.getX(index);
      const worldZ = centerZ + positions.getZ(index);
      const influence = this.getMountainInfluenceAt(worldX, worldZ);
      const snow = clamp((influence - 0.72) / 0.28, 0, 1);

      color.copy(baseColor).lerp(slopeColor, influence).lerp(snowColor, smoothstep(snow));
      colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  }

  private createRoadSplines(layout: CityLayoutPlan): RoadSpline[] {
    return layout.roads.map((road) => this.createRoadSpline(road));
  }

  private createRoadSpline(road: CityRoadSegment): RoadSpline {
    const points = [road.start.clone(), road.end.clone()];
    const sampleCount = Math.max(1, Math.ceil(road.length / ROAD_SPLINE_SAMPLE_STEP));
    const samples: THREE.Vector2[] = [];
    const cumulativeLengths: number[] = [0];

    for (let index = 0; index <= sampleCount; index += 1) {
      const alpha = index / sampleCount;
      samples.push(new THREE.Vector2(road.start.x + (road.end.x - road.start.x) * alpha, road.start.y + (road.end.y - road.start.y) * alpha));
      if (index > 0) {
        cumulativeLengths.push(
          cumulativeLengths[index - 1] + samples[index - 1].distanceTo(samples[index]),
        );
      }
    }

    return {
      road,
      points,
      samples,
      cumulativeLengths,
      length: cumulativeLengths[cumulativeLengths.length - 1] ?? road.length,
      width: road.width,
    };
  }

  private createRoadMaskGeometry(splines: RoadSpline[]): THREE.BufferGeometry {
    const bounds = getRoadSplineBounds(splines, ROAD_WIDTH * 0.5 + ROAD_MASK_PADDING);
    const minX = Math.floor(bounds.minX / ROAD_MASK_CELL_SIZE) * ROAD_MASK_CELL_SIZE;
    const maxX = Math.ceil(bounds.maxX / ROAD_MASK_CELL_SIZE) * ROAD_MASK_CELL_SIZE;
    const minZ = Math.floor(bounds.minZ / ROAD_MASK_CELL_SIZE) * ROAD_MASK_CELL_SIZE;
    const maxZ = Math.ceil(bounds.maxZ / ROAD_MASK_CELL_SIZE) * ROAD_MASK_CELL_SIZE;
    const positions: number[] = [];
    const indices: number[] = [];

    for (let x = minX; x < maxX; x += ROAD_MASK_CELL_SIZE) {
      for (let z = minZ; z < maxZ; z += ROAD_MASK_CELL_SIZE) {
        const centerX = x + ROAD_MASK_CELL_SIZE * 0.5;
        const centerZ = z + ROAD_MASK_CELL_SIZE * 0.5;
        const roadDistance = this.getRoadSignedDistance(centerX, centerZ, splines);

        if (roadDistance > 0) {
          continue;
        }

        const baseIndex = positions.length / 3;
        const corners = [
          [x, z],
          [x + ROAD_MASK_CELL_SIZE, z],
          [x + ROAD_MASK_CELL_SIZE, z + ROAD_MASK_CELL_SIZE],
          [x, z + ROAD_MASK_CELL_SIZE],
        ];
        for (const [cornerX, cornerZ] of corners) {
          positions.push(cornerX, this.getTerrainHeightAt(cornerX, cornerZ) + ROAD_SURFACE_OFFSET, cornerZ);
        }

        const a = baseIndex;
        const b = baseIndex + 1;
        const c = baseIndex + 2;
        const d = baseIndex + 3;
        indices.push(a, d, b, b, d, c);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private getRoadSignedDistance(x: number, z: number, splines: RoadSpline[]): number {
    let nearest = Infinity;

    for (const spline of splines) {
      const radius = spline.width * 0.5;
      for (let index = 0; index < spline.samples.length - 1; index += 1) {
        const start = spline.samples[index];
        const end = spline.samples[index + 1];
        nearest = Math.min(nearest, distanceToSegment(x, z, start.x, start.y, end.x, end.y) - radius);
      }
    }

    return nearest;
  }

  private createRoadMarkingGeometry(
    spline: RoadSpline,
    lateralOffset: number,
    markingWidth: number,
    dashed: boolean,
  ): THREE.BufferGeometry {
    const dashLength = 9;
    const gapLength = 7;
    const positions: number[] = [];
    const indices: number[] = [];
    const startClearance = this.getRoadMarkingClearance(spline.road.startNodeId);
    const endClearance = this.getRoadMarkingClearance(spline.road.endNodeId);
    const startDistance = Math.min(startClearance, spline.length * 0.42);
    const endDistance = Math.max(startDistance, spline.length - Math.min(endClearance, spline.length * 0.42));
    const spans = dashed
      ? createDashedRoadSpans(startDistance, endDistance, dashLength, gapLength)
      : [[startDistance, endDistance]];

    for (const [start, end] of spans) {
      if (end <= start) {
        continue;
      }
      const segmentCount = Math.max(1, Math.ceil((end - start) / ROAD_GEOMETRY_STEP));
      let previousLeft = -1;
      let previousRight = -1;

      for (let segment = 0; segment <= segmentCount; segment += 1) {
        const along = start + ((end - start) * segment) / segmentCount;
        const sample = sampleRoadSplineAt(spline, along);
        let leftIndex = -1;
        let rightIndex = -1;
        for (const lateral of [lateralOffset - markingWidth / 2, lateralOffset + markingWidth / 2]) {
          const x = sample.position.x + sample.normal.x * lateral;
          const z = sample.position.y + sample.normal.y * lateral;
          const vertexIndex = positions.length / 3;
          positions.push(
            x,
            this.getTerrainHeightAt(x, z) + ROAD_SURFACE_OFFSET + ROAD_MARKING_OFFSET,
            z,
          );
          if (leftIndex < 0) {
            leftIndex = vertexIndex;
          } else {
            rightIndex = vertexIndex;
          }
        }

        if (previousLeft >= 0 && previousRight >= 0) {
          indices.push(previousLeft, previousRight, leftIndex, leftIndex, previousRight, rightIndex);
        }
        previousLeft = leftIndex;
        previousRight = rightIndex;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    return geometry;
  }

  private getRoadMarkingClearance(nodeId: number): number {
    const node = this.roadNodesById.get(nodeId);
    return node && node.roadIds.length > 2 ? ROAD_INTERSECTION_MARKING_CLEARANCE : 2;
  }

  private projectGeometryToTerrain(
    geometry: THREE.BufferGeometry,
    centerX: number,
    centerZ: number,
    yOffset: number,
  ): void {
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index += 1) {
      const localX = positions.getX(index);
      const localZ = positions.getZ(index);
      positions.setY(index, this.getTerrainHeightAt(centerX + localX, centerZ + localZ) + yOffset);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
  }
}

function getCellBounds(cell: CityLayoutCell): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return getPolygonBounds(cell.vertices);
}

function createCenteredBounds(halfExtent: number): CityLayoutBounds {
  return {
    minX: -halfExtent,
    maxX: halfExtent,
    minZ: -halfExtent,
    maxZ: halfExtent,
  };
}

function expandBounds(bounds: CityLayoutBounds, padding: number): CityLayoutBounds {
  return {
    minX: bounds.minX - padding,
    maxX: bounds.maxX + padding,
    minZ: bounds.minZ - padding,
    maxZ: bounds.maxZ + padding,
  };
}

function getDistanceOutsideBounds(x: number, z: number, bounds: CityLayoutBounds): number {
  const dx = x < bounds.minX ? bounds.minX - x : x > bounds.maxX ? x - bounds.maxX : 0;
  const dz = z < bounds.minZ ? bounds.minZ - z : z > bounds.maxZ ? z - bounds.maxZ : 0;
  return Math.hypot(dx, dz);
}

function getTerrainPatchFrame(bounds: CityLayoutBounds): {
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  widthSegments: number;
  depthSegments: number;
} {
  const minX = bounds.minX - TERRAIN_EDGE_PADDING;
  const maxX = bounds.maxX + TERRAIN_EDGE_PADDING;
  const minZ = bounds.minZ - TERRAIN_EDGE_PADDING;
  const maxZ = bounds.maxZ + TERRAIN_EDGE_PADDING;
  const width = Math.max(TERRAIN_SIZE, maxX - minX);
  const depth = Math.max(TERRAIN_SIZE, maxZ - minZ);

  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width,
    depth,
    widthSegments: Math.max(TERRAIN_SEGMENTS, Math.ceil((width / TERRAIN_SIZE) * TERRAIN_SEGMENTS)),
    depthSegments: Math.max(TERRAIN_SEGMENTS, Math.ceil((depth / TERRAIN_SIZE) * TERRAIN_SEGMENTS)),
  };
}

function smoothstep(value: number): number {
  const alpha = clamp(value, 0, 1);
  return alpha * alpha * (3 - 2 * alpha);
}

function getPolygonBounds(vertices: THREE.Vector2[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const vertex of vertices) {
    minX = Math.min(minX, vertex.x);
    maxX = Math.max(maxX, vertex.x);
    minZ = Math.min(minZ, vertex.y);
    maxZ = Math.max(maxZ, vertex.y);
  }

  return { minX, maxX, minZ, maxZ };
}

function polygonArea(vertices: THREE.Vector2[]): number {
  let area = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index];
    const b = vertices[(index + 1) % vertices.length];
    area += a.x * b.y - b.x * a.y;
  }

  return Math.abs(area) * 0.5;
}

function pointInPolygon(x: number, z: number, vertices: THREE.Vector2[]): boolean {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const a = vertices[index];
    const b = vertices[previous];
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }

  return inside;
}

function distanceToPolygonEdges(x: number, z: number, vertices: THREE.Vector2[]): number {
  let distance = Infinity;
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    distance = Math.min(distance, distanceToSegment(x, z, start.x, start.y, end.x, end.y));
  }

  return distance;
}

function distanceToSegment(
  x: number,
  z: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 0.0001) {
    return Math.hypot(x - startX, z - startZ);
  }

  const t = clamp(((x - startX) * dx + (z - startZ) * dz) / lengthSq, 0, 1);
  const closestX = startX + dx * t;
  const closestZ = startZ + dz * t;
  return Math.hypot(x - closestX, z - closestZ);
}

function getRoadSplineBounds(
  splines: RoadSpline[],
  padding: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const spline of splines) {
    for (const sample of spline.samples) {
      minX = Math.min(minX, sample.x);
      maxX = Math.max(maxX, sample.x);
      minZ = Math.min(minZ, sample.y);
      maxZ = Math.max(maxZ, sample.y);
    }
  }

  return {
    minX: minX - padding,
    maxX: maxX + padding,
    minZ: minZ - padding,
    maxZ: maxZ + padding,
  };
}

function sampleRoadSplineAt(
  spline: RoadSpline,
  distance: number,
): { position: THREE.Vector2; normal: THREE.Vector2 } {
  const clampedDistance = clamp(distance, 0, spline.length);
  let index = 0;
  while (index < spline.cumulativeLengths.length - 1 && spline.cumulativeLengths[index + 1] < clampedDistance) {
    index += 1;
  }

  const start = spline.samples[index];
  const end = spline.samples[Math.min(index + 1, spline.samples.length - 1)];
  const segmentStart = spline.cumulativeLengths[index] ?? 0;
  const segmentEnd = spline.cumulativeLengths[Math.min(index + 1, spline.cumulativeLengths.length - 1)] ?? segmentStart;
  const segmentLength = Math.max(0.001, segmentEnd - segmentStart);
  const alpha = clamp((clampedDistance - segmentStart) / segmentLength, 0, 1);
  const position = start.clone().lerp(end, alpha);
  const tangent = end.clone().sub(start);
  if (tangent.lengthSq() <= 0.0001) {
    tangent.set(0, 1);
  } else {
    tangent.normalize();
  }

  return {
    position,
    normal: new THREE.Vector2(-tangent.y, tangent.x),
  };
}

function createDashedRoadSpans(
  startDistance: number,
  endDistance: number,
  dashLength: number,
  gapLength: number,
): number[][] {
  const spans: number[][] = [];
  for (let start = startDistance; start < endDistance; start += dashLength + gapLength) {
    spans.push([start, Math.min(start + dashLength, endDistance)]);
  }

  return spans;
}

function createPerlinNoise(random: () => number): (x: number, z: number) => number {
  const permutation = Array.from({ length: 256 }, (_, index) => index);
  for (let index = permutation.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [permutation[index], permutation[swapIndex]] = [permutation[swapIndex], permutation[index]];
  }

  const table = new Array<number>(512);
  for (let index = 0; index < table.length; index += 1) {
    table[index] = permutation[index & 255];
  }

  return (x: number, z: number): number => {
    const xi = Math.floor(x) & 255;
    const zi = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(zf);

    const aa = table[table[xi] + zi];
    const ab = table[table[xi] + zi + 1];
    const ba = table[table[xi + 1] + zi];
    const bb = table[table[xi + 1] + zi + 1];

    const x1 = mix(grad2(aa, xf, zf), grad2(ba, xf - 1, zf), u);
    const x2 = mix(grad2(ab, xf, zf - 1), grad2(bb, xf - 1, zf - 1), u);
    return clamp(mix(x1, x2, v), -1, 1);
  };
}

function fade(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function mix(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

function grad2(hash: number, x: number, z: number): number {
  switch (hash & 7) {
    case 0:
      return x + z;
    case 1:
      return -x + z;
    case 2:
      return x - z;
    case 3:
      return -x - z;
    case 4:
      return x;
    case 5:
      return -x;
    case 6:
      return z;
    default:
      return -z;
  }
}
