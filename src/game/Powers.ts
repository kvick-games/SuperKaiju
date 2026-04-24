import * as THREE from "three";
import type { City } from "./City";
import type { EnemyManager } from "./Enemies";
import { FireManager } from "./Fire";
import type { InputController } from "./Input";
import { clamp, pointToRayDistance } from "./math";
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
const SPARK_NORMAL = new THREE.Vector3();

const FROST_PARTICLE_COUNT = 190;
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

export class PowerSystem {
  private readonly heatLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly heatCore: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly heatHalo: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly heatImpact: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly heatLight: THREE.PointLight;
  private readonly fires: FireManager;
  private readonly frostCone: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  private readonly frostParticles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly frostPositions: Float32Array;
  private readonly frostSeeds: Float32Array;
  private readonly sparkLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly sparkPositions: Float32Array;
  private readonly sparks: Spark[] = [];
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
      new THREE.CylinderGeometry(0.58, 0.34, 1, 16, 1, true),
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
      new THREE.CylinderGeometry(2.4, 1.1, 1, 24, 1, true),
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
    this.fires.reset();
    this.frostCone.visible = false;
    this.frostParticles.visible = false;
    this.clearSparks();
  }

  update(delta: number, input: InputController, player: Player, enemies: EnemyManager, city: City): PowerSnapshot {
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
      this.fireFrostBreath(delta, enemies, ORIGIN, FORWARD);
    } else {
      this.frostCone.visible = false;
      this.frostParticles.visible = false;
    }

    if (!this.heatActive && !this.frostActive && !player.boostActive) {
      player.rechargeEnergy(0.18 * delta);
    }

    this.updateSparks(delta);
    this.fires.update(delta);

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
  ): void {
    const range = 240;
    let closestAlong = range;
    let hitEnemy: ReturnType<EnemyManager["getAlive"]>[number] | null = null;
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
      hitSurface = true;
      SPARK_NORMAL.copy(forward).multiplyScalar(-1);
    }

    if (!hitSurface && forward.y < -0.02) {
      const groundAlong = -origin.y / forward.y;
      if (groundAlong > 0 && groundAlong < closestAlong) {
        closestAlong = groundAlong;
        hitSurface = true;
        SPARK_NORMAL.set(0, 1, 0);
      }
    }

    HIT_POINT.copy(origin).addScaledVector(forward, closestAlong);
    if (hitEnemy) {
      hitEnemy.takeDamage(118 * delta);
    }

    this.heatLine.geometry.setFromPoints([origin, HIT_POINT]);
    this.heatLine.visible = true;
    this.heatLine.material.opacity = hitEnemy ? 0.98 : 0.54;
    this.placeBeamMesh(this.heatCore, origin, HIT_POINT, hitEnemy ? 1.45 : 1);
    this.placeBeamMesh(this.heatHalo, origin, HIT_POINT, hitEnemy ? 1.28 : 0.88);
    this.heatCore.visible = true;
    this.heatHalo.visible = true;
    this.heatImpact.visible = true;
    this.heatImpact.position.copy(HIT_POINT);
    this.heatImpact.scale.setScalar(hitSurface ? 1.3 + Math.sin(performance.now() * 0.038) * 0.18 : 0.58);
    this.heatImpact.material.opacity = hitSurface ? 0.9 : 0.34;
    this.heatLight.position.copy(HIT_POINT);
    this.heatLight.intensity = hitSurface ? 78 : 24;

    if (hitSurface) {
      this.emitSparks(HIT_POINT, SPARK_NORMAL, hitEnemy ? 1.35 : 1);
      this.fires.emitTrail(HIT_POINT, SPARK_NORMAL, hitEnemy ? 1.35 : 1.15, forward, origin);
    } else {
      this.fires.resetTrail();
    }
  }

  private fireFrostBreath(delta: number, enemies: EnemyManager, origin: THREE.Vector3, forward: THREE.Vector3): void {
    const range = 88;
    const coneDot = Math.cos(0.34);

    for (const enemy of enemies.getAlive()) {
      const center = enemy.position.clone();
      center.y += 18;
      TO_ENEMY.copy(center).sub(origin);
      const distance = TO_ENEMY.length();
      if (distance <= range && TO_ENEMY.normalize().dot(forward) > coneDot) {
        const effect = 1 - clamp(distance / range, 0, 1) * 0.38;
        enemy.applyFrost(delta * 0.82 * effect);
        enemy.takeDamage(delta * 7.5 * effect);
      }
    }

    this.frostCone.position.copy(origin).addScaledVector(forward, range * 0.5);
    NEG_FORWARD.copy(forward).multiplyScalar(-1);
    this.frostCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), NEG_FORWARD);
    this.frostCone.scale.setScalar(1 + Math.sin(performance.now() * 0.01) * 0.035);
    this.frostCone.visible = true;
    this.updateFrostParticles(origin, forward, range);
    this.frostParticles.visible = true;
  }

  private hideHeatVision(): void {
    this.heatLine.visible = false;
    this.heatCore.visible = false;
    this.heatHalo.visible = false;
    this.heatImpact.visible = false;
    this.heatLight.intensity = 0;
    this.fires.resetTrail();
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

  private updateFrostParticles(origin: THREE.Vector3, forward: THREE.Vector3, range: number): void {
    FROST_RIGHT.crossVectors(forward, WORLD_UP);
    if (FROST_RIGHT.lengthSq() < 0.001) {
      FROST_RIGHT.set(1, 0, 0);
    }
    FROST_RIGHT.normalize();
    FROST_UP.crossVectors(FROST_RIGHT, forward).normalize();

    const time = performance.now() * 0.001;
    for (let index = 0; index < FROST_PARTICLE_COUNT; index += 1) {
      const seedIndex = index * 4;
      const travel = ((this.frostSeeds[seedIndex] + time * (0.52 + this.frostSeeds[seedIndex + 3] * 0.5)) % 1) * range;
      const spread = 1.2 + travel * 0.25;
      const angle = this.frostSeeds[seedIndex + 1] * Math.PI * 2 + time * (1.1 + this.frostSeeds[seedIndex + 2]);
      const radius = Math.sqrt(this.frostSeeds[seedIndex + 2]) * spread;
      const swirl = Math.sin(time * 4 + index) * 0.7;
      const x = origin.x + forward.x * travel + FROST_RIGHT.x * Math.cos(angle) * radius + FROST_UP.x * Math.sin(angle) * radius + FROST_RIGHT.x * swirl;
      const y = origin.y + forward.y * travel + FROST_RIGHT.y * Math.cos(angle) * radius + FROST_UP.y * Math.sin(angle) * radius + FROST_UP.y * swirl;
      const z = origin.z + forward.z * travel + FROST_RIGHT.z * Math.cos(angle) * radius + FROST_UP.z * Math.sin(angle) * radius + FROST_RIGHT.z * swirl;
      const positionIndex = index * 3;
      this.frostPositions[positionIndex] = x;
      this.frostPositions[positionIndex + 1] = y;
      this.frostPositions[positionIndex + 2] = z;
    }

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
