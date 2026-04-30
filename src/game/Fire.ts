import * as THREE from "three";
import type { FireNodeView } from "./FireSimulation";
import { clamp } from "./math";

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FIRE_NORMAL = new THREE.Vector3();
const MAX_FIRE_ACTORS = 96;

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

  private nodeId = -1;
  private age = 0;
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

  sync(node: FireNodeView, delta: number): void {
    if (this.nodeId !== node.id) {
      this.nodeId = node.id;
      this.age = 0;
      this.seed = Math.random() * Math.PI * 2;
      this.baseScale = 0.82 + Math.random() * 0.42;
    }

    const intensity = clamp(node.intensity, 0, 1);
    this.age += delta * (0.75 + intensity * 0.65);
    FIRE_NORMAL.copy(node.normal);
    if (FIRE_NORMAL.lengthSq() < 0.001) {
      FIRE_NORMAL.copy(WORLD_UP);
    }
    FIRE_NORMAL.normalize();

    const pulse = 1 + Math.sin(this.age * 16.5 + this.seed) * 0.09 + Math.sin(this.age * 31 + this.seed * 0.4) * 0.045;
    const scale = this.baseScale * (0.46 + intensity * 0.88) * pulse;

    this.group.position.copy(node.point).addScaledVector(FIRE_NORMAL, 0.9);
    this.group.quaternion.setFromUnitVectors(WORLD_UP, FIRE_NORMAL);
    this.group.rotateY(this.seed);
    this.group.scale.setScalar(scale);
    this.group.visible = true;
    this.outerFlame.scale.set(0.82 + Math.sin(this.age * 22 + this.seed) * 0.12, 1.05 + Math.sin(this.age * 18) * 0.16, 0.82);
    this.innerFlame.scale.set(0.86, 0.88 + Math.cos(this.age * 28 + this.seed) * 0.18, 0.86);
    this.glow.scale.setScalar(0.9 + Math.sin(this.age * 14 + this.seed) * 0.16);
    this.smoke.scale.setScalar(0.62 + this.age * 0.08 + intensity * 0.35);

    this.base.material.opacity = 0.42 * intensity;
    this.glow.material.opacity = 0.28 * intensity;
    this.outerFlame.material.opacity = 0.68 * intensity;
    this.innerFlame.material.opacity = 0.6 * intensity;
    this.smoke.material.opacity = 0.16 * intensity;
  }

  hide(): void {
    this.nodeId = -1;
    this.group.visible = false;
    this.base.material.opacity = 0;
    this.glow.material.opacity = 0;
    this.outerFlame.material.opacity = 0;
    this.innerFlame.material.opacity = 0;
    this.smoke.material.opacity = 0;
  }
}

export class FireManager {
  private readonly actors: FireActor[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  reset(): void {
    for (const actor of this.actors) {
      actor.hide();
    }
  }

  update(delta: number, nodes: readonly FireNodeView[]): void {
    const visibleCount = Math.min(nodes.length, MAX_FIRE_ACTORS);
    for (let index = 0; index < visibleCount; index += 1) {
      this.getActor(index).sync(nodes[index], delta);
    }

    for (let index = visibleCount; index < this.actors.length; index += 1) {
      this.actors[index].hide();
    }
  }

  private getActor(index: number): FireActor {
    let actor = this.actors[index];
    if (!actor) {
      actor = new FireActor();
      this.actors[index] = actor;
      this.scene.add(actor.group);
    }

    return actor;
  }
}
