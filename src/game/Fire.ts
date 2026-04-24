import * as THREE from "three";
import { clamp } from "./math";

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TRAIL_DIRECTION = new THREE.Vector3();
const TRAIL_POINT = new THREE.Vector3();
const FIRE_NORMAL = new THREE.Vector3();
const SCORCH_DIRECTION = new THREE.Vector3();
const SCORCH_POINT = new THREE.Vector3();

const MAX_FIRE_ACTORS = 96;
const FIRE_TRAIL_SPACING = 4.6;
const FIRE_JUMP_RESET_DISTANCE = 34;
const FIRE_SPAWN_INTERVAL = 0.12;
const MAX_TRAIL_SPAWNS_PER_FRAME = 4;

const BASE_GEOMETRY = new THREE.CylinderGeometry(1.85, 2.15, 0.28, 14);
const GLOW_GEOMETRY = new THREE.SphereGeometry(2.15, 12, 8);
const OUTER_FLAME_GEOMETRY = new THREE.ConeGeometry(1.18, 5.1, 8, 1, true);
const INNER_FLAME_GEOMETRY = new THREE.ConeGeometry(0.64, 3.4, 8, 1, true);
const SMOKE_GEOMETRY = new THREE.SphereGeometry(1.2, 8, 6);

class FireActor {
  readonly group = new THREE.Group();

  private readonly base: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly glow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly outerFlame: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  private readonly innerFlame: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  private readonly smoke: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;

  private age = 0;
  private life = 0;
  private maxLife = 1;
  private seed = 0;
  private baseScale = 1;

  constructor() {
    this.group.visible = false;

    this.base = new THREE.Mesh(
      BASE_GEOMETRY,
      new THREE.MeshBasicMaterial({
        color: 0xff5c16,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.base.position.y = 0.08;

    this.glow = new THREE.Mesh(
      GLOW_GEOMETRY,
      new THREE.MeshBasicMaterial({
        color: 0xff360d,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.glow.position.y = 1.5;

    this.outerFlame = new THREE.Mesh(
      OUTER_FLAME_GEOMETRY,
      new THREE.MeshBasicMaterial({
        color: 0xff641c,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.outerFlame.position.y = 2.6;

    this.innerFlame = new THREE.Mesh(
      INNER_FLAME_GEOMETRY,
      new THREE.MeshBasicMaterial({
        color: 0xffc84e,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.innerFlame.position.y = 2.3;

    this.smoke = new THREE.Mesh(
      SMOKE_GEOMETRY,
      new THREE.MeshBasicMaterial({
        color: 0x2b2824,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.smoke.position.y = 3.9;

    this.group.add(this.base, this.glow, this.outerFlame, this.innerFlame, this.smoke);
  }

  get active(): boolean {
    return this.life > 0;
  }

  get remainingLife(): number {
    return this.life;
  }

  ignite(point: THREE.Vector3, normal: THREE.Vector3, intensity: number): void {
    FIRE_NORMAL.copy(normal);
    if (FIRE_NORMAL.lengthSq() < 0.001) {
      FIRE_NORMAL.copy(WORLD_UP);
    }
    FIRE_NORMAL.normalize();

    this.age = 0;
    this.maxLife = 1.05 + Math.random() * 0.65;
    this.life = this.maxLife;
    this.seed = Math.random() * Math.PI * 2;
    this.baseScale = (0.82 + Math.random() * 0.42) * clamp(intensity, 0.55, 1.55);

    this.group.position.copy(point).addScaledVector(FIRE_NORMAL, 0.9);
    this.group.quaternion.setFromUnitVectors(WORLD_UP, FIRE_NORMAL);
    this.group.rotateY(Math.random() * Math.PI * 2);
    this.group.scale.setScalar(this.baseScale * 0.42);
    this.group.visible = true;
  }

  update(delta: number): void {
    if (this.life <= 0) {
      return;
    }

    this.age += delta;
    this.life = Math.max(0, this.life - delta);
    const fade = clamp(this.life / Math.min(0.72, this.maxLife), 0, 1);
    const rise = clamp(this.age / 0.16, 0, 1);
    const pulse = 1 + Math.sin(this.age * 16.5 + this.seed) * 0.09 + Math.sin(this.age * 31 + this.seed * 0.4) * 0.045;
    const scale = this.baseScale * (0.58 + rise * 0.48) * pulse;

    this.group.scale.setScalar(scale);
    this.outerFlame.scale.set(0.82 + Math.sin(this.age * 22 + this.seed) * 0.12, 1.05 + Math.sin(this.age * 18) * 0.16, 0.82);
    this.innerFlame.scale.set(0.86, 0.88 + Math.cos(this.age * 28 + this.seed) * 0.18, 0.86);
    this.glow.scale.setScalar(0.9 + Math.sin(this.age * 14 + this.seed) * 0.16);
    this.smoke.scale.setScalar(0.62 + this.age * 0.5);

    this.base.material.opacity = 0.46 * fade;
    this.glow.material.opacity = 0.32 * fade;
    this.outerFlame.material.opacity = 0.7 * fade;
    this.innerFlame.material.opacity = 0.62 * fade;
    this.smoke.material.opacity = 0.2 * fade * clamp(this.age / 0.5, 0, 1);

    if (this.life <= 0) {
      this.group.visible = false;
    }
  }

  reset(): void {
    this.life = 0;
    this.group.visible = false;
  }
}

export class FireManager {
  private readonly actors: FireActor[] = [];
  private readonly lastTrailPoint = new THREE.Vector3();
  private hasLastTrailPoint = false;
  private spawnCooldown = 0;

  constructor(private readonly scene: THREE.Scene) {}

  reset(): void {
    this.hasLastTrailPoint = false;
    this.spawnCooldown = 0;
    for (const actor of this.actors) {
      actor.reset();
    }
  }

  resetTrail(): void {
    this.hasLastTrailPoint = false;
  }

  emitTrail(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    intensity = 1,
    trailDirection?: THREE.Vector3,
    trailOrigin?: THREE.Vector3,
  ): void {
    if (!this.hasLastTrailPoint) {
      this.spawnAt(point, normal, intensity, trailDirection, trailOrigin);
      this.lastTrailPoint.copy(point);
      this.hasLastTrailPoint = true;
      this.spawnCooldown = FIRE_SPAWN_INTERVAL;
      return;
    }

    const distance = this.lastTrailPoint.distanceTo(point);
    if (distance > FIRE_JUMP_RESET_DISTANCE) {
      this.spawnAt(point, normal, intensity, trailDirection, trailOrigin);
      this.lastTrailPoint.copy(point);
      this.spawnCooldown = FIRE_SPAWN_INTERVAL;
      return;
    }

    if (distance >= FIRE_TRAIL_SPACING) {
      TRAIL_DIRECTION.copy(point).sub(this.lastTrailPoint).normalize();
      let spawned = 0;
      let traveled = FIRE_TRAIL_SPACING;
      while (traveled <= distance && spawned < MAX_TRAIL_SPAWNS_PER_FRAME) {
        TRAIL_POINT.copy(this.lastTrailPoint).addScaledVector(TRAIL_DIRECTION, traveled);
        this.spawnAt(TRAIL_POINT, normal, intensity, trailDirection, trailOrigin);
        spawned += 1;
        traveled += FIRE_TRAIL_SPACING;
      }
      this.lastTrailPoint.copy(TRAIL_POINT);
      this.spawnCooldown = FIRE_SPAWN_INTERVAL;
      return;
    }

    if (this.spawnCooldown <= 0) {
      this.spawnAt(point, normal, intensity * 0.9, trailDirection, trailOrigin);
      this.lastTrailPoint.copy(point);
      this.spawnCooldown = FIRE_SPAWN_INTERVAL;
    }
  }

  update(delta: number): void {
    this.spawnCooldown = Math.max(0, this.spawnCooldown - delta);
    for (const actor of this.actors) {
      actor.update(delta);
    }
  }

  private spawnAt(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    intensity: number,
    trailDirection?: THREE.Vector3,
    trailOrigin?: THREE.Vector3,
  ): void {
    this.getActor().ignite(point, normal, intensity);
    if (!trailDirection || trailDirection.lengthSq() < 0.001) {
      return;
    }

    SCORCH_DIRECTION.copy(trailDirection).normalize();
    const availableBacktrack = trailOrigin ? Math.max(0, point.distanceTo(trailOrigin) - 8) : 12;
    const clusterCount = Math.min(2, Math.floor(availableBacktrack / 6));
    for (let index = 1; index <= clusterCount; index += 1) {
      const backtrack = Math.min(availableBacktrack, index * (4.5 + Math.random() * 1.3));
      SCORCH_POINT.copy(point).addScaledVector(SCORCH_DIRECTION, -backtrack);
      this.getActor().ignite(SCORCH_POINT, normal, intensity * Math.max(0.5, 0.92 - index * 0.12));
    }
  }

  private getActor(): FireActor {
    const inactive = this.actors.find((actor) => !actor.active);
    if (inactive) {
      return inactive;
    }

    if (this.actors.length < MAX_FIRE_ACTORS) {
      const actor = new FireActor();
      this.actors.push(actor);
      this.scene.add(actor.group);
      return actor;
    }

    return this.actors.reduce((oldest, actor) => (actor.remainingLife < oldest.remainingLife ? actor : oldest), this.actors[0]);
  }
}
