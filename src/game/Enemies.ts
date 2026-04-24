import * as THREE from "three";
import { clamp, horizontalDistance, randomRange } from "./math";
import type { Building, City } from "./City";
import type { Player } from "./Player";

const TARGET = new THREE.Vector3();
const MOVE = new THREE.Vector3();

class Enemy {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly radius: number;

  health: number;
  freeze = 0;
  defeated = false;

  private attackTimer = 0;
  private stompTimer = 0;
  private readonly maxHealth: number;
  private readonly speed: number;
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private readonly healthFill: THREE.Mesh;
  private readonly leftArm: THREE.Mesh;
  private readonly rightArm: THREE.Mesh;
  private readonly leftLeg: THREE.Mesh;
  private readonly rightLeg: THREE.Mesh;

  constructor(
    readonly id: number,
    spawn: THREE.Vector3,
    readonly displayName: string,
  ) {
    this.position.copy(spawn);
    this.radius = 9 + id * 0.7;
    this.maxHealth = 165 + id * 42;
    this.health = this.maxHealth;
    this.speed = 13.5 + id * 1.25;
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.28 + id * 0.045, 0.42, 0.32),
      roughness: 0.82,
      metalness: 0.03,
    });

    const parts = this.createMonsterMesh();
    this.leftArm = parts.leftArm;
    this.rightArm = parts.rightArm;
    this.leftLeg = parts.leftLeg;
    this.rightLeg = parts.rightLeg;
    this.healthFill = parts.healthFill;

    this.group.name = displayName;
    this.group.position.copy(this.position);
  }

  reset(spawn: THREE.Vector3): void {
    this.position.copy(spawn);
    this.group.position.copy(this.position);
    this.group.rotation.set(0, 0, 0);
    this.health = this.maxHealth;
    this.freeze = 0;
    this.defeated = false;
    this.attackTimer = 0;
    this.stompTimer = 0;
    this.group.visible = true;
    this.group.scale.setScalar(1);
    this.healthFill.scale.x = 1;
  }

  update(delta: number, city: City, player: Player, camera: THREE.Camera): void {
    if (this.defeated) {
      return;
    }

    this.freeze = clamp(this.freeze - delta * 0.12, 0, 1);
    this.attackTimer = Math.max(0, this.attackTimer - delta);
    this.stompTimer += delta;

    const targetBuilding = city.getNearestStandingBuilding(this.position, 260);
    if (targetBuilding) {
      TARGET.copy(targetBuilding.position);
    } else {
      TARGET.copy(player.position);
      TARGET.y = 0;
    }

    const attackRange = targetBuilding ? this.radius + Math.max(targetBuilding.halfX, targetBuilding.halfZ) + 3.5 : 8;
    const distance = horizontalDistance(this.position, TARGET);
    const frozen = this.freeze > 0.92;

    if (distance > attackRange && !frozen) {
      MOVE.copy(TARGET).sub(this.position);
      MOVE.y = 0;
      MOVE.normalize();
      const speed = this.speed * (1 - this.freeze * 0.78);
      this.position.addScaledVector(MOVE, speed * delta);
      this.group.rotation.y = Math.atan2(MOVE.x, MOVE.z);
    } else if (targetBuilding && this.attackTimer <= 0 && !frozen) {
      this.attack(targetBuilding, city);
    }

    this.group.position.copy(this.position);
    this.animate(delta, camera);
  }

  takeDamage(amount: number): void {
    if (this.defeated) {
      return;
    }

    this.health = Math.max(0, this.health - amount);
    this.healthFill.scale.x = Math.max(0.001, this.health / this.maxHealth);
    if (this.health <= 0) {
      this.defeated = true;
      this.group.visible = false;
    }
  }

  applyFrost(amount: number): void {
    if (!this.defeated) {
      this.freeze = clamp(this.freeze + amount, 0, 1);
    }
  }

  private attack(targetBuilding: Building, city: City): void {
    this.attackTimer = 1.15 + this.id * 0.08;
    city.damageBuilding(targetBuilding, 34 + this.id * 4);
    city.damageNear(this.position, this.radius + 5, 8 + this.id * 2);
  }

  private animate(delta: number, camera: THREE.Camera): void {
    const walk = Math.sin(this.stompTimer * (4.4 - this.freeze * 2.2));
    const frozenTension = this.freeze * 0.18;
    this.leftArm.rotation.x = 0.45 + walk * 0.28 - frozenTension;
    this.rightArm.rotation.x = -0.45 - walk * 0.28 + frozenTension;
    this.leftLeg.rotation.x = -walk * 0.18;
    this.rightLeg.rotation.x = walk * 0.18;
    this.group.scale.y = 1 + Math.sin(this.stompTimer * 3.2) * 0.018 * (1 - this.freeze);

    this.bodyMaterial.color.lerpColors(new THREE.Color(0x43682f), new THREE.Color(0xb8edf2), this.freeze * 0.78);
    this.healthFill.parent?.lookAt(camera.position);
    this.healthFill.parent?.rotateY(Math.PI);
    this.healthFill.parent?.scale.setScalar(1 + Math.sin(performance.now() * 0.004 + this.id) * 0.012);
    this.group.rotation.z = Math.sin(this.stompTimer * 2.7 + this.id) * 0.025 * (1 - this.freeze);

    if (this.freeze > 0.65) {
      this.group.rotation.z += Math.sin(performance.now() * 0.016) * 0.008;
    }

    this.group.updateMatrixWorld();
    this.group.position.y = Math.sin(this.stompTimer * 7.2) * delta * 0.2;
  }

  private createMonsterMesh(): {
    leftArm: THREE.Mesh;
    rightArm: THREE.Mesh;
    leftLeg: THREE.Mesh;
    rightLeg: THREE.Mesh;
    healthFill: THREE.Mesh;
  } {
    const hornMaterial = new THREE.MeshStandardMaterial({ color: 0xe5d4a3, roughness: 0.7 });
    const clawMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2f2e, roughness: 0.78 });
    const bellyMaterial = new THREE.MeshStandardMaterial({ color: 0x6b7b54, roughness: 0.86 });

    const body = new THREE.Mesh(new THREE.DodecahedronGeometry(9.6 + this.id * 0.55, 0), this.bodyMaterial);
    body.position.y = 17;
    body.scale.set(1.05, 1.38, 0.82);
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);

    const belly = new THREE.Mesh(new THREE.SphereGeometry(5.8, 12, 8), bellyMaterial);
    belly.position.set(0, 15.4, -4.7);
    belly.scale.set(0.96, 1.2, 0.42);
    belly.castShadow = true;
    this.group.add(belly);

    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(5.6 + this.id * 0.2, 1), this.bodyMaterial);
    head.position.set(0, 30.5, -1.2);
    head.scale.set(1.1, 0.82, 1);
    head.castShadow = true;
    this.group.add(head);

    for (const x of [-2.6, 2.6]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.8, 7), hornMaterial);
      horn.position.set(x, 34.6, -1.3);
      horn.rotation.x = -0.28;
      horn.castShadow = true;
      this.group.add(horn);
    }

    const armGeo = new THREE.CapsuleGeometry(1.65, 11.4, 4, 8);
    const leftArm = new THREE.Mesh(armGeo, this.bodyMaterial);
    leftArm.position.set(-10, 17.2, -0.5);
    leftArm.rotation.z = 0.42;
    leftArm.castShadow = true;
    this.group.add(leftArm);

    const rightArm = leftArm.clone();
    rightArm.position.x = 10;
    rightArm.rotation.z = -0.42;
    this.group.add(rightArm);

    const legGeo = new THREE.CapsuleGeometry(2.1, 7.4, 4, 8);
    const leftLeg = new THREE.Mesh(legGeo, this.bodyMaterial);
    leftLeg.position.set(-4.2, 6, 1.4);
    leftLeg.castShadow = true;
    this.group.add(leftLeg);

    const rightLeg = leftLeg.clone();
    rightLeg.position.x = 4.2;
    this.group.add(rightLeg);

    for (let spine = 0; spine < 5; spine += 1) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(1.15, 4.2, 6), clawMaterial);
      spike.position.set(0, 11 + spine * 4.2, 5.7);
      spike.rotation.x = Math.PI / 2;
      spike.castShadow = true;
      this.group.add(spike);
    }

    const healthGroup = new THREE.Group();
    healthGroup.position.set(0, 40.5, 0);
    const healthBack = new THREE.Mesh(
      new THREE.BoxGeometry(15, 1.1, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x191e22 }),
    );
    const healthFill = new THREE.Mesh(
      new THREE.BoxGeometry(14.2, 0.62, 0.62),
      new THREE.MeshBasicMaterial({ color: 0xd75d4b }),
    );
    healthFill.position.x = 0;
    healthGroup.add(healthBack, healthFill);
    this.group.add(healthGroup);

    this.group.position.copy(this.position);
    return { leftArm, rightArm, leftLeg, rightLeg, healthFill };
  }
}

export class EnemyManager {
  private readonly enemies: Enemy[] = [];
  private readonly spawns = [
    new THREE.Vector3(-196, 0, -182),
    new THREE.Vector3(188, 0, -162),
    new THREE.Vector3(170, 0, 190),
  ];

  constructor(private readonly scene: THREE.Scene) {
    const names = ["Bracken Maw", "Cinderback", "Glasshorn"];
    for (let index = 0; index < this.spawns.length; index += 1) {
      const enemy = new Enemy(index, this.spawns[index], names[index]);
      this.enemies.push(enemy);
      this.scene.add(enemy.group);
    }
  }

  reset(): void {
    for (let index = 0; index < this.enemies.length; index += 1) {
      const spawn = this.spawns[index].clone();
      spawn.x += randomRange(() => ((index + 3) % 7) / 7, -8, 8);
      this.enemies[index].reset(spawn);
    }
  }

  update(delta: number, city: City, player: Player, camera: THREE.Camera): void {
    for (const enemy of this.enemies) {
      enemy.update(delta, city, player, camera);
    }
  }

  getAlive(): Enemy[] {
    return this.enemies.filter((enemy) => !enemy.defeated);
  }

  remaining(): number {
    return this.getAlive().length;
  }
}

export type { Enemy };
