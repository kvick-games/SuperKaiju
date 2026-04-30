import * as THREE from "three";
import type { City, CityDamageTarget } from "./City";
import type { EnemyManager } from "./Enemies";
import { FireManager } from "./Fire";
import { FireSimulation } from "./FireSimulation";
import type { PlayerInputSource } from "./Input";
import { clamp, lerp, pointToRayDistance } from "./math";
import type { Player } from "./Player";
import type { PowerSnapshot } from "./types";

const ORIGIN = new THREE.Vector3();
const FORWARD = new THREE.Vector3();
const HIT_POINT = new THREE.Vector3();
const TO_ENEMY = new THREE.Vector3();
const NEG_FORWARD = new THREE.Vector3();
const BEAM_MIDPOINT = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FROST_RIGHT = new THREE.Vector3();
const FROST_UP = new THREE.Vector3();
const FROST_CENTER = new THREE.Vector3();
const FROST_MATRIX = new THREE.Matrix4();
const FROST_QUATERNION = new THREE.Quaternion();
const FROST_SCALE = new THREE.Vector3();
const FROST_COLOR = new THREE.Color();
const SPARK_NORMAL = new THREE.Vector3();

const FROST_PARTICLE_COUNT = 190;
const FROST_CLOUD_COUNT = 28;
const FROST_EMISSION_RATE = 18;
const FROST_CLOUD_FREEZE_RATE = 0.2;
const FROST_CLOUD_DAMAGE_RATE = 1.85;
const FROST_CLOUD_BUILDING_COLD_RATE = 0.24;
const FROST_CLOUD_BUILDING_STRESS_DAMAGE_RATE = 1.15;
const HEAT_BUILDING_DAMAGE_RATE = 118;
const SPARK_COUNT = 140;
const POWER_EMPTY_ENERGY = 0.012;
const HEAT_START_ENERGY = 0.16;
const FROST_START_ENERGY = 0.18;

interface Spark {
  position: THREE.Vector3;
  previous: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface FrostCloud {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  startRadius: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  seed: number;
}

export class PowerSystem {
  private readonly heatLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly heatCore: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly heatHalo: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly heatImpact: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly heatLight: THREE.PointLight;
  private readonly fires: FireManager;
  private readonly fireSimulation = new FireSimulation();
  private readonly frostCone: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  private readonly frostCloudMesh: THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly frostParticles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly frostPositions: Float32Array;
  private readonly frostSeeds: Float32Array;
  private readonly sparkLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly sparkPositions: Float32Array;
  private readonly frostClouds: FrostCloud[] = [];
  private readonly sparks: Spark[] = [];
  private fireCity: City | null = null;
  private fireCityGeneration = -1;
  private frostEmitAccumulator = 1;
  private heatActive = false;
  private frostActive = false;
  private heatLockedOut = false;
  private frostLockedOut = false;
  private heatStatus = "Ready";
  private frostStatus = "Ready";

  constructor(scene: THREE.Scene) {
    this.heatLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0xff2319, transparent: true, opacity: 0.96 }),
    );
    this.heatLine.visible = false;
    scene.add(this.heatLine);

    this.heatCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.29, 0.17, 1, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff2a18,
        transparent: true,
        opacity: 0.98,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.heatCore.visible = false;
    scene.add(this.heatCore);

    this.heatHalo = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 0.55, 1, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xd71912,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.heatHalo.visible = false;
    scene.add(this.heatHalo);

    this.heatImpact = new THREE.Mesh(
      new THREE.SphereGeometry(3.6, 20, 14),
      new THREE.MeshBasicMaterial({
        color: 0xff351d,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.heatImpact.visible = false;
    scene.add(this.heatImpact);

    this.heatLight = new THREE.PointLight(0xff2415, 0, 62, 2);
    scene.add(this.heatLight);

    this.fires = new FireManager(scene);

    this.frostCone = new THREE.Mesh(
      new THREE.ConeGeometry(22, 82, 32, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x9be7ef,
        transparent: true,
        opacity: 0.17,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.frostCone.visible = false;
    scene.add(this.frostCone);

    this.frostCloudMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 18, 12),
      new THREE.MeshBasicMaterial({
        color: 0xb7f5ff,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
      FROST_CLOUD_COUNT,
    );
    this.frostCloudMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.frostCloudMesh.frustumCulled = false;
    this.frostCloudMesh.visible = false;
    scene.add(this.frostCloudMesh);

    for (let index = 0; index < FROST_CLOUD_COUNT; index += 1) {
      this.frostClouds.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        startRadius: 0,
        radius: 0,
        maxRadius: 0,
        life: 0,
        maxLife: 0,
        seed: Math.random(),
      });
      FROST_SCALE.setScalar(0.001);
      FROST_MATRIX.compose(ORIGIN, FROST_QUATERNION, FROST_SCALE);
      this.frostCloudMesh.setMatrixAt(index, FROST_MATRIX);
      this.frostCloudMesh.setColorAt(index, FROST_COLOR.setRGB(0, 0, 0));
    }
    this.frostCloudMesh.instanceMatrix.needsUpdate = true;
    if (this.frostCloudMesh.instanceColor) {
      this.frostCloudMesh.instanceColor.needsUpdate = true;
    }

    this.frostPositions = new Float32Array(FROST_PARTICLE_COUNT * 3);
    this.frostSeeds = new Float32Array(FROST_PARTICLE_COUNT * 4);
    for (let index = 0; index < FROST_PARTICLE_COUNT; index += 1) {
      this.frostSeeds[index * 4] = Math.random();
      this.frostSeeds[index * 4 + 1] = Math.random();
      this.frostSeeds[index * 4 + 2] = Math.random();
      this.frostSeeds[index * 4 + 3] = Math.random();
    }

    const frostGeometry = new THREE.BufferGeometry();
    frostGeometry.setAttribute("position", new THREE.BufferAttribute(this.frostPositions, 3));
    this.frostParticles = new THREE.Points(
      frostGeometry,
      new THREE.PointsMaterial({
        color: 0xd5fbff,
        size: 2.4,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.frostParticles.visible = false;
    scene.add(this.frostParticles);

    this.sparkPositions = new Float32Array(SPARK_COUNT * 2 * 3);
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute("position", new THREE.BufferAttribute(this.sparkPositions, 3));
    this.sparkLines = new THREE.LineSegments(
      sparkGeometry,
      new THREE.LineBasicMaterial({
        color: 0xffb02e,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.sparkLines.frustumCulled = false;
    scene.add(this.sparkLines);

    for (let index = 0; index < SPARK_COUNT; index += 1) {
      this.sparks.push({
        position: new THREE.Vector3(),
        previous: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
      });
    }
  }

  reset(): void {
    this.heatActive = false;
    this.frostActive = false;
    this.heatLockedOut = false;
    this.frostLockedOut = false;
    this.heatStatus = "Ready";
    this.frostStatus = "Ready";
    this.heatLine.visible = false;
    this.heatCore.visible = false;
    this.heatHalo.visible = false;
    this.heatImpact.visible = false;
    this.heatLight.intensity = 0;
    this.fireSimulation.reset();
    this.fires.reset();
    this.frostCone.visible = false;
    this.frostEmitAccumulator = 1;
    this.clearFrostClouds();
    this.frostParticles.visible = false;
    this.clearSparks();
  }

  update(delta: number, input: PlayerInputSource, player: Player, enemies: EnemyManager, city: City): PowerSnapshot {
    const heatHeld = input.isMouseDown(0);
    const frostHeld = input.isMouseDown(2);

    if (!heatHeld) {
      this.heatLockedOut = false;
    }
    if (!frostHeld) {
      this.frostLockedOut = false;
    }

    this.heatActive =
      heatHeld &&
      !this.heatLockedOut &&
      (this.heatActive ? player.energy > POWER_EMPTY_ENERGY : player.energy >= HEAT_START_ENERGY);
    this.frostActive =
      frostHeld &&
      !this.frostLockedOut &&
      (this.frostActive ? player.energy > POWER_EMPTY_ENERGY : player.energy >= FROST_START_ENERGY);

    ORIGIN.copy(player.position).addScaledVector(player.getForward(FORWARD), 4.5);
    ORIGIN.y += 0.35;
    this.ensureFireBurnables(city);

    if (this.heatActive) {
      player.drainEnergy(0.17 * delta);
      if (player.energy <= POWER_EMPTY_ENERGY) {
        this.heatLockedOut = true;
      }
      this.fireHeatVision(delta, enemies, city, ORIGIN, FORWARD);
    } else {
      this.hideHeatVision();
    }

    if (this.frostActive) {
      player.drainEnergy(0.155 * delta);
      if (player.energy <= POWER_EMPTY_ENERGY) {
        this.frostLockedOut = true;
      }
      this.fireFrostBreath(delta, ORIGIN, FORWARD);
    } else {
      this.frostCone.visible = false;
      this.frostEmitAccumulator = 1;
    }
    this.updateFrostClouds(delta, enemies, city);

    if (!this.heatActive && !this.frostActive && !player.boostActive) {
      player.rechargeEnergy(0.18 * delta);
    }

    this.updateSparks(delta);
    this.fireSimulation.update(delta);
    this.fires.update(delta, this.fireSimulation.getActiveNodes());

    this.heatStatus = this.heatActive
      ? "Firing"
      : heatHeld && this.heatLockedOut
        ? "Drained"
        : player.energy < HEAT_START_ENERGY
          ? "Charging"
          : "Ready";
    this.frostStatus = this.frostActive
      ? "Freezing"
      : frostHeld && this.frostLockedOut
        ? "Drained"
        : player.energy < FROST_START_ENERGY
          ? "Charging"
          : "Ready";

    return {
      heatActive: this.heatActive,
      frostActive: this.frostActive,
      fireIntensity: this.fireSimulation.getAudioIntensity(player.position),
      heatStatus: this.heatStatus,
      frostStatus: this.frostStatus,
    };
  }

  renderSnapshot(
    delta: number,
    player: Player,
    snapshot: Pick<PowerSnapshot, "heatActive" | "frostActive" | "heatStatus" | "frostStatus">,
    enemies: EnemyManager,
    city: City,
  ): PowerSnapshot {
    this.heatActive = snapshot.heatActive;
    this.frostActive = snapshot.frostActive;
    this.heatStatus = snapshot.heatStatus;
    this.frostStatus = snapshot.frostStatus;

    ORIGIN.copy(player.position).addScaledVector(player.getForward(FORWARD), 4.5);
    ORIGIN.y += 0.35;
    this.ensureFireBurnables(city);

    if (this.heatActive) {
      this.fireHeatVision(delta, enemies, city, ORIGIN, FORWARD, false);
    } else {
      this.hideHeatVision();
    }

    if (this.frostActive) {
      this.fireFrostBreath(delta, ORIGIN, FORWARD, false);
    } else {
      this.frostCone.visible = false;
      this.frostEmitAccumulator = 1;
    }

    this.updateFrostClouds(delta, enemies, city, false);
    this.updateSparks(delta);
    this.fireSimulation.update(delta);
    this.fires.update(delta, this.fireSimulation.getActiveNodes());

    return {
      heatActive: this.heatActive,
      frostActive: this.frostActive,
      fireIntensity: this.fireSimulation.getAudioIntensity(player.position),
      heatStatus: this.heatStatus,
      frostStatus: this.frostStatus,
    };
  }

  private fireHeatVision(
    delta: number,
    enemies: EnemyManager,
    city: City,
    origin: THREE.Vector3,
    forward: THREE.Vector3,
    applyWorldEffects = true,
  ): void {
    const range = 240;
    let closestAlong = range;
    let hitEnemy: ReturnType<EnemyManager["getAlive"]>[number] | null = null;
    let hitCityTarget: CityDamageTarget | null = null;
    let hitSurface = false;
    SPARK_NORMAL.copy(forward).multiplyScalar(-1);

    for (const enemy of enemies.getAlive()) {
      const center = enemy.position.clone();
      center.y += 21;
      const hit = pointToRayDistance(center, origin, forward, range);
      if (hit.distance < enemy.radius * 1.08 && hit.along < closestAlong) {
        closestAlong = hit.along;
        hitEnemy = enemy;
        hitSurface = true;
        SPARK_NORMAL.copy(center).sub(origin).normalize().multiplyScalar(-1);
      }
    }

    const buildingHit = city.raycastBuildings(origin, forward, closestAlong);
    if (buildingHit && buildingHit.along < closestAlong) {
      closestAlong = buildingHit.along;
      hitEnemy = null;
      hitCityTarget = buildingHit.target;
      hitSurface = true;
      SPARK_NORMAL.copy(forward).multiplyScalar(-1);
    }

    if (!hitSurface && forward.y < -0.02) {
      const terrainAlong = city.raycastTerrainDistance(origin, forward, closestAlong);
      if (terrainAlong !== null && terrainAlong > 0 && terrainAlong < closestAlong) {
        closestAlong = terrainAlong;
        hitSurface = true;
        SPARK_NORMAL.set(0, 1, 0);
      }
    }

    HIT_POINT.copy(origin).addScaledVector(forward, closestAlong);
    if (applyWorldEffects && hitEnemy) {
      hitEnemy.warm(delta * 0.34);
      hitEnemy.takeDamage(118 * delta);
    } else if (applyWorldEffects && hitCityTarget) {
      city.warmTarget(hitCityTarget, delta * 0.42);
      city.damageTarget(hitCityTarget, HEAT_BUILDING_DAMAGE_RATE * delta, HIT_POINT);
    }

    const hitDamageTarget = hitEnemy !== null || hitCityTarget !== null;
    this.heatLine.geometry.setFromPoints([origin, HIT_POINT]);
    this.heatLine.visible = true;
    this.heatLine.material.opacity = hitDamageTarget ? 0.98 : 0.54;
    this.placeBeamMesh(this.heatCore, origin, HIT_POINT, hitDamageTarget ? 1.45 : 1);
    this.placeBeamMesh(this.heatHalo, origin, HIT_POINT, hitDamageTarget ? 1.28 : 0.88);
    this.heatCore.visible = true;
    this.heatHalo.visible = true;
    this.heatImpact.visible = true;
    this.heatImpact.position.copy(HIT_POINT);
    this.heatImpact.scale.setScalar(hitSurface ? 1.3 + Math.sin(performance.now() * 0.038) * 0.18 : 0.58);
    this.heatImpact.material.opacity = hitSurface ? 0.9 : 0.34;
    this.heatLight.position.copy(HIT_POINT);
    this.heatLight.intensity = hitSurface ? 78 : 24;

    if (hitSurface) {
      this.emitSparks(HIT_POINT, SPARK_NORMAL, hitDamageTarget ? 1.35 : 1);
      if (!hitEnemy) {
        this.fireSimulation.igniteAt(HIT_POINT, SPARK_NORMAL, delta * 12, forward);
      }
    }
  }

  private fireFrostBreath(delta: number, origin: THREE.Vector3, forward: THREE.Vector3, applyWorldEffects = true): void {
    const range = 88;
    this.frostEmitAccumulator += delta * FROST_EMISSION_RATE;

    let emitted = 0;
    while (this.frostEmitAccumulator >= 1 && emitted < 4) {
      this.emitFrostCloud(origin, forward, range);
      this.frostEmitAccumulator -= 1;
      emitted += 1;
    }

    if (emitted >= 4) {
      this.frostEmitAccumulator = Math.min(this.frostEmitAccumulator, 1);
    }

    this.frostCone.position.copy(origin).addScaledVector(forward, range * 0.5);
    if (applyWorldEffects) {
      this.fireSimulation.applySuppressionCone(origin, forward, range, 0.34, delta * 5.6);
    }
    NEG_FORWARD.copy(forward).multiplyScalar(-1);
    this.frostCone.quaternion.setFromUnitVectors(WORLD_UP, NEG_FORWARD);
    this.frostCone.scale.setScalar(1 + Math.sin(performance.now() * 0.01) * 0.035);
    this.frostCone.material.opacity = 0.08 + Math.sin(performance.now() * 0.014) * 0.018;
    this.frostCone.visible = true;
  }

  private hideHeatVision(): void {
    this.heatLine.visible = false;
    this.heatCore.visible = false;
    this.heatHalo.visible = false;
    this.heatImpact.visible = false;
    this.heatLight.intensity = 0;
  }

  private ensureFireBurnables(city: City): void {
    if (this.fireCity === city && this.fireCityGeneration === city.generationId) {
      return;
    }

    this.fireSimulation.clearBurnables();
    this.fireCity = city;
    this.fireCityGeneration = city.generationId;

    for (const burnable of city.getBurnables()) {
      this.fireSimulation.registerBurnable(burnable);
    }
  }

  private placeBeamMesh(
    mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>,
    origin: THREE.Vector3,
    end: THREE.Vector3,
    pulseScale: number,
  ): void {
    const length = origin.distanceTo(end);
    BEAM_MIDPOINT.copy(origin).lerp(end, 0.5);
    mesh.position.copy(BEAM_MIDPOINT);
    mesh.quaternion.setFromUnitVectors(WORLD_UP, FORWARD);
    mesh.scale.set(pulseScale, length, pulseScale);
    mesh.material.opacity = mesh === this.heatCore ? 0.98 : 0.3 + Math.sin(performance.now() * 0.026) * 0.06;
  }

  private emitFrostCloud(origin: THREE.Vector3, forward: THREE.Vector3, range: number): void {
    FROST_RIGHT.crossVectors(forward, WORLD_UP);
    if (FROST_RIGHT.lengthSq() < 0.001) {
      FROST_RIGHT.set(1, 0, 0);
    }
    FROST_RIGHT.normalize();
    FROST_UP.crossVectors(FROST_RIGHT, forward).normalize();

    let cloud = this.frostClouds[0];
    for (const candidate of this.frostClouds) {
      if (candidate.life <= 0) {
        cloud = candidate;
        break;
      }
      if (candidate.life < cloud.life) {
        cloud = candidate;
      }
    }

    const angle = Math.random() * Math.PI * 2;
    const spawnRadius = Math.sqrt(Math.random()) * 4.8;
    const maxLife = 0.92 + Math.random() * 0.38;
    const speed = (range / maxLife) * (0.68 + Math.random() * 0.18);

    cloud.position
      .copy(origin)
      .addScaledVector(forward, 5 + Math.random() * 6)
      .addScaledVector(FROST_RIGHT, Math.cos(angle) * spawnRadius)
      .addScaledVector(FROST_UP, Math.sin(angle) * spawnRadius * 0.72);
    cloud.velocity
      .copy(forward)
      .multiplyScalar(speed)
      .addScaledVector(FROST_RIGHT, (Math.random() - 0.5) * 15)
      .addScaledVector(FROST_UP, (Math.random() - 0.35) * 9);
    cloud.startRadius = 3.8 + Math.random() * 2.6;
    cloud.radius = cloud.startRadius;
    cloud.maxRadius = 14 + Math.random() * 8;
    cloud.life = maxLife;
    cloud.maxLife = maxLife;
    cloud.seed = Math.random();
  }

  private updateFrostClouds(delta: number, enemies: EnemyManager, city: City, applyWorldEffects = true): void {
    const aliveEnemies = applyWorldEffects ? enemies.getAlive() : [];
    let activeCount = 0;

    for (let index = 0; index < this.frostClouds.length; index += 1) {
      const cloud = this.frostClouds[index];

      if (cloud.life > 0) {
        cloud.life = Math.max(0, cloud.life - delta);
      }

      if (cloud.life > 0) {
        activeCount += 1;
        cloud.position.addScaledVector(cloud.velocity, delta);
        cloud.velocity.multiplyScalar(Math.max(0, 1 - delta * 0.32));

        const lifeRatio = cloud.life / cloud.maxLife;
        const age = 1 - lifeRatio;
        const growth = age * age * (3 - 2 * age);
        const cloudStrength = clamp(age * 3.2, 0, 1) * clamp(lifeRatio * 4, 0, 1);
        cloud.radius = lerp(cloud.startRadius, cloud.maxRadius, growth);

        for (const enemy of aliveEnemies) {
          FROST_CENTER.copy(enemy.position);
          FROST_CENTER.y += 18;
          TO_ENEMY.copy(FROST_CENTER).sub(cloud.position);
          const effectRadius = cloud.radius + enemy.radius * 0.85;
          const distance = TO_ENEMY.length();

          if (distance < effectRadius) {
            const radiusFalloff = 1 - clamp(distance / effectRadius, 0, 1);
            const effect = radiusFalloff * radiusFalloff * cloudStrength;
            enemy.applyCold(delta * FROST_CLOUD_FREEZE_RATE * effect);
            enemy.takeDamage(delta * FROST_CLOUD_DAMAGE_RATE * effect);
          }
        }

        if (applyWorldEffects) {
          for (const building of city.buildings) {
            if (building.destroyed) {
              continue;
            }

            const halfHeight = building.height * building.mesh.scale.y * 0.5;
            const centerY = building.baseY + halfHeight;
            const dx = Math.max(Math.abs(cloud.position.x - building.position.x) - building.halfX, 0);
            const dy = Math.max(Math.abs(cloud.position.y - centerY) - halfHeight, 0);
            const dz = Math.max(Math.abs(cloud.position.z - building.position.z) - building.halfZ, 0);
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (distance < cloud.radius) {
              const radiusFalloff = 1 - clamp(distance / cloud.radius, 0, 1);
              const effect = radiusFalloff * radiusFalloff * cloudStrength;
              FROST_CENTER.set(
                clamp(cloud.position.x, building.position.x - building.halfX, building.position.x + building.halfX),
                clamp(cloud.position.y, building.baseY, building.baseY + building.height * building.mesh.scale.y),
                clamp(cloud.position.z, building.position.z - building.halfZ, building.position.z + building.halfZ),
              );
              city.applyColdToBuilding(building, delta * FROST_CLOUD_BUILDING_COLD_RATE * effect);
              if (building.cold.value > 0.7) {
                city.damageBuilding(
                  building,
                  delta * FROST_CLOUD_BUILDING_STRESS_DAMAGE_RATE * building.cold.value * effect,
                  FROST_CENTER,
                );
              }
            }
          }
        }

        FROST_SCALE.setScalar(cloud.radius * (0.68 + lifeRatio * 0.32));
        FROST_MATRIX.compose(cloud.position, FROST_QUATERNION, FROST_SCALE);
        this.frostCloudMesh.setMatrixAt(index, FROST_MATRIX);

        const glow = (0.28 + lifeRatio * 0.72) * cloudStrength;
        this.frostCloudMesh.setColorAt(index, FROST_COLOR.setRGB(0.42 * glow, 0.86 * glow, glow));
      } else {
        cloud.radius = 0;
        FROST_SCALE.setScalar(0.001);
        FROST_MATRIX.compose(cloud.position, FROST_QUATERNION, FROST_SCALE);
        this.frostCloudMesh.setMatrixAt(index, FROST_MATRIX);
        this.frostCloudMesh.setColorAt(index, FROST_COLOR.setRGB(0, 0, 0));
      }
    }

    this.frostCloudMesh.visible = activeCount > 0;
    this.frostCloudMesh.instanceMatrix.needsUpdate = true;
    if (this.frostCloudMesh.instanceColor) {
      this.frostCloudMesh.instanceColor.needsUpdate = true;
    }
    this.updateFrostParticles(activeCount);
  }

  private updateFrostParticles(activeCloudCount: number): void {
    if (activeCloudCount <= 0) {
      this.frostParticles.visible = false;
      this.frostPositions.fill(0);
      this.frostParticles.geometry.attributes.position.needsUpdate = true;
      return;
    }

    let fallbackCloud: FrostCloud | null = null;
    for (const cloud of this.frostClouds) {
      if (cloud.life > 0) {
        fallbackCloud = cloud;
        break;
      }
    }

    const time = performance.now() * 0.001;
    for (let index = 0; index < FROST_PARTICLE_COUNT; index += 1) {
      const seedIndex = index * 4;
      const cloudIndex = (Math.floor(this.frostSeeds[seedIndex] * FROST_CLOUD_COUNT) + index) % FROST_CLOUD_COUNT;
      const cloud = this.frostClouds[cloudIndex].life > 0 ? this.frostClouds[cloudIndex] : fallbackCloud;
      const positionIndex = index * 3;

      if (!cloud) {
        this.frostPositions[positionIndex] = 0;
        this.frostPositions[positionIndex + 1] = 0;
        this.frostPositions[positionIndex + 2] = 0;
        continue;
      }

      const shellRadius = cloud.radius * (0.2 + this.frostSeeds[seedIndex] * 0.72);
      const vertical = (this.frostSeeds[seedIndex + 2] * 2 - 1) * shellRadius * 0.82;
      const flatRadius = Math.sqrt(Math.max(0, shellRadius * shellRadius - vertical * vertical));
      const angle = this.frostSeeds[seedIndex + 1] * Math.PI * 2 + time * (1.1 + this.frostSeeds[seedIndex + 2]);
      const swirl = Math.sin(time * 4 + cloud.seed * 11 + index) * (0.4 + this.frostSeeds[seedIndex + 3] * 0.8);
      const x = cloud.position.x + Math.cos(angle) * flatRadius + swirl;
      const y = cloud.position.y + vertical + Math.sin(angle * 1.7) * swirl;
      const z = cloud.position.z + Math.sin(angle) * flatRadius - swirl * 0.6;
      this.frostPositions[positionIndex] = x;
      this.frostPositions[positionIndex + 1] = y;
      this.frostPositions[positionIndex + 2] = z;
    }

    this.frostParticles.visible = true;
    this.frostParticles.geometry.attributes.position.needsUpdate = true;
  }

  private emitSparks(point: THREE.Vector3, normal: THREE.Vector3, intensity: number): void {
    const emitCount = Math.floor(8 * intensity);
    for (let emitted = 0; emitted < emitCount; emitted += 1) {
      const spark = this.sparks.find((candidate) => candidate.life <= 0);
      if (!spark) {
        return;
      }

      const angle = Math.random() * Math.PI * 2;
      const radial = new THREE.Vector3(Math.cos(angle), Math.random() * 0.8 + 0.18, Math.sin(angle)).normalize();
      spark.position.copy(point).addScaledVector(radial, Math.random() * 1.4);
      spark.previous.copy(spark.position);
      spark.velocity
        .copy(normal)
        .multiplyScalar(18 + Math.random() * 24)
        .addScaledVector(radial, 16 + Math.random() * 34);
      spark.life = 0.18 + Math.random() * 0.22;
      spark.maxLife = spark.life;
    }
  }

  private updateSparks(delta: number): void {
    let active = 0;
    for (let index = 0; index < this.sparks.length; index += 1) {
      const spark = this.sparks[index];
      const positionIndex = index * 6;

      if (spark.life > 0) {
        active += 1;
        spark.life = Math.max(0, spark.life - delta);
        spark.previous.copy(spark.position);
        spark.velocity.y -= 58 * delta;
        spark.velocity.multiplyScalar(1 - delta * 1.7);
        spark.position.addScaledVector(spark.velocity, delta);

        const fade = spark.life / Math.max(0.001, spark.maxLife);
        this.sparkPositions[positionIndex] = spark.previous.x;
        this.sparkPositions[positionIndex + 1] = spark.previous.y;
        this.sparkPositions[positionIndex + 2] = spark.previous.z;
        this.sparkPositions[positionIndex + 3] = spark.position.x;
        this.sparkPositions[positionIndex + 4] = spark.position.y + fade * 0.6;
        this.sparkPositions[positionIndex + 5] = spark.position.z;
      } else {
        this.sparkPositions[positionIndex] = 0;
        this.sparkPositions[positionIndex + 1] = 0;
        this.sparkPositions[positionIndex + 2] = 0;
        this.sparkPositions[positionIndex + 3] = 0;
        this.sparkPositions[positionIndex + 4] = 0;
        this.sparkPositions[positionIndex + 5] = 0;
      }
    }

    this.sparkLines.visible = active > 0;
    this.sparkLines.material.opacity = active > 0 ? 0.95 : 0;
    this.sparkLines.geometry.attributes.position.needsUpdate = true;
  }

  private clearFrostClouds(): void {
    for (let index = 0; index < this.frostClouds.length; index += 1) {
      const cloud = this.frostClouds[index];
      cloud.life = 0;
      cloud.radius = 0;
      cloud.position.set(0, 0, 0);
      cloud.velocity.set(0, 0, 0);
      FROST_SCALE.setScalar(0.001);
      FROST_MATRIX.compose(cloud.position, FROST_QUATERNION, FROST_SCALE);
      this.frostCloudMesh.setMatrixAt(index, FROST_MATRIX);
      this.frostCloudMesh.setColorAt(index, FROST_COLOR.setRGB(0, 0, 0));
    }

    this.frostCloudMesh.visible = false;
    this.frostCloudMesh.instanceMatrix.needsUpdate = true;
    if (this.frostCloudMesh.instanceColor) {
      this.frostCloudMesh.instanceColor.needsUpdate = true;
    }
    this.frostPositions.fill(0);
    this.frostParticles.geometry.attributes.position.needsUpdate = true;
    this.frostParticles.visible = false;
  }

  private clearSparks(): void {
    for (const spark of this.sparks) {
      spark.life = 0;
    }
    this.sparkPositions.fill(0);
    this.sparkLines.geometry.attributes.position.needsUpdate = true;
    this.sparkLines.visible = false;
    this.sparkLines.material.opacity = 0;
  }
}
