import * as THREE from "three";
import { ColdComponent, type ColdEnvironment } from "./Cold";
import { clamp, damp, horizontalDistance, lerp, randomRange } from "./math";
import type { Building, City, CityDamageTarget } from "./City";
import { DEFAULT_KAIJU_CLASSES, type KaijuAbilityKind, type KaijuClass } from "./KaijuClasses";
import { createKaijuRig, type KaijuAttackKind, type KaijuRigInstance } from "./KaijuRig";
import type { Player } from "./Player";
import type { EnemySnapshot } from "../multiplayer/protocol";

const TARGET = new THREE.Vector3();
const MOVE = new THREE.Vector3();
const RAM_DIRECTION = new THREE.Vector3();
const ABILITY_ORIGIN = new THREE.Vector3();
const ABILITY_TARGET = new THREE.Vector3();
const ABILITY_DIRECTION = new THREE.Vector3();
const ABILITY_END = new THREE.Vector3();
const ABILITY_MIDPOINT = new THREE.Vector3();
const ABILITY_UP = new THREE.Vector3(0, 1, 0);
const TAIL_RIGHT = new THREE.Vector3();
const STUN_DISPLACEMENT = new THREE.Vector3();
const STUN_PLAYER_CARRY = new THREE.Vector3();
const STUN_RAGDOLL_ROOT = new THREE.Vector3();
const PLAYER_SPRINT_ENEMY_RADIUS = 5.5;
const PLAYER_SPRINT_ENEMY_CENTER_Y = 24;
const PLAYER_SPRINT_ENEMY_VERTICAL_RADIUS = 34;
const PLAYER_SPRINT_ENEMY_MIN_SPEED = 42;
const PLAYER_SPRINT_ENEMY_DAMAGE_BASE = 28;
const PLAYER_SPRINT_ENEMY_DAMAGE_SPEED_SCALE = 0.42;
const PLAYER_SPRINT_ENEMY_KNOCKBACK_BASE = 34;
const PLAYER_SPRINT_ENEMY_KNOCKBACK_SPEED_SCALE = 0.38;
const PLAYER_SPRINT_ENEMY_HIT_COOLDOWN = 0.32;
const ENEMY_KNOCKBACK_DAMPING = 4.8;
const ENEMY_WORLD_LIMIT = 225;
const DEFEAT_RAGDOLL_UPWARD_IMPULSE = 22;
const LIVE_RAGDOLL_STUN_BASE = 0.82;
const LIVE_RAGDOLL_STUN_SPEED_SCALE = 0.008;
const LIVE_RAGDOLL_STUN_MAX = 1.55;
const LIVE_RAGDOLL_PLAYER_CARRY_SCALE = 0.72;
const LIVE_RAGDOLL_KNOCKBACK_CARRY_SCALE = 0.34;
const LIVE_RAGDOLL_CARRY_DAMPING = 2.6;
const TAIL_SPIKE_POOL_SIZE = 9;
const TAIL_SPIKE_SPEED = 88;
const TAIL_SPIKE_LIFE = 2.25;
const TAIL_SPIKE_HIT_RADIUS = 3.8;
const FIRE_BREATH_RANGE = 168;
const FIRE_BREATH_DAMAGE_RATE = 72;
const FIRE_BREATH_SPLASH_RADIUS = 11;
const FIRE_BREATH_SPLASH_DAMAGE_RATE = 18;
const SHOCKWAVE_RADIUS = 58;
const SHOCKWAVE_DAMAGE = 30;
const SHOCKWAVE_LIFE = 0.72;

export interface EnemySmashEvent {
  kind: KaijuAttackKind;
  position: THREE.Vector3;
  intensity: number;
}

interface TailSpikeProjectile {
  mesh: THREE.Mesh<THREE.ConeGeometry, THREE.MeshStandardMaterial>;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

class Enemy {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly radius: number;
  readonly cold = new ColdComponent(0.12);

  health: number;
  defeated = false;

  private attackTimer = 0;
  private attackElapsed = Number.POSITIVE_INFINITY;
  private attackDuration = 1;
  private attackDamageApplied = true;
  private attackTarget: Building | null = null;
  private attackKind: KaijuAttackKind | null = null;
  private attackCounter = 0;
  private stompTimer = 0;
  private movingAmount = 0;
  private sprintHitCooldown = 0;
  private stunnedTimer = 0;
  private readonly stunnedCarryVelocity = new THREE.Vector3();
  private activeAbility: KaijuAbilityKind | null = null;
  private abilityElapsed = Number.POSITIVE_INFINITY;
  private abilityDuration = 1;
  private abilityCooldown = 0;
  private abilityEffectApplied = true;
  private abilityImpactPulse = 0;
  private shockwaveLife = 0;
  private shockwaveMaxLife = SHOCKWAVE_LIFE;
  private readonly abilityTarget = new THREE.Vector3();
  private readonly knockbackVelocity = new THREE.Vector3();
  private readonly defeatImpulse = new THREE.Vector3();
  private readonly maxHealth: number;
  private readonly speed: number;
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private readonly healthFill: THREE.Mesh;
  private readonly rig: KaijuRigInstance;
  private readonly abilityEffects = new THREE.Group();
  private readonly tailSpikes: TailSpikeProjectile[] = [];
  private readonly fireBreathLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly fireBreathCore: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly fireBreathHalo: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly fireBreathImpact: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly fireBreathLight: THREE.PointLight;
  private readonly shockwaveMesh: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;

  constructor(
    private readonly scene: THREE.Scene,
    readonly id: number,
    spawn: THREE.Vector3,
    readonly kaijuClass: KaijuClass,
  ) {
    this.position.copy(spawn);
    this.radius = kaijuClass.radius;
    this.maxHealth = kaijuClass.maxHealth;
    this.health = this.maxHealth;
    this.speed = kaijuClass.speed;
    this.bodyMaterial = kaijuClass.createBodyMaterial();

    this.rig = createKaijuRig(id, this.bodyMaterial, kaijuClass.rigProfile);
    this.healthFill = this.rig.healthFill;
    this.group.add(this.rig.root);
    this.abilityEffects.name = `${kaijuClass.displayName} ability effects`;
    this.scene.add(this.abilityEffects);
    this.fireBreathLine = this.createFireBreathLine();
    this.fireBreathCore = this.createFireBreathBeam(0x9befff, 0.9);
    this.fireBreathHalo = this.createFireBreathBeam(0x2b6cff, 0.3);
    this.fireBreathImpact = this.createFireBreathImpact();
    this.fireBreathLight = new THREE.PointLight(0x58cfff, 0, 78, 2);
    this.abilityEffects.add(this.fireBreathLine, this.fireBreathCore, this.fireBreathHalo, this.fireBreathImpact, this.fireBreathLight);
    this.shockwaveMesh = this.createShockwaveMesh();
    this.abilityEffects.add(this.shockwaveMesh);
    this.createTailSpikePool();
    this.clearAbilityEffects();

    this.group.name = kaijuClass.displayName;
    this.group.position.copy(this.position);
  }

  reset(spawn: THREE.Vector3): void {
    this.position.copy(spawn);
    this.group.position.copy(this.position);
    this.group.rotation.set(0, 0, 0);
    this.health = this.maxHealth;
    this.cold.reset();
    this.defeated = false;
    this.attackTimer = 0;
    this.attackElapsed = Number.POSITIVE_INFINITY;
    this.attackDuration = 1;
    this.attackDamageApplied = true;
    this.attackTarget = null;
    this.attackKind = null;
    this.stompTimer = 0;
    this.movingAmount = 0;
    this.sprintHitCooldown = 0;
    this.stunnedTimer = 0;
    this.stunnedCarryVelocity.set(0, 0, 0);
    this.activeAbility = null;
    this.abilityElapsed = Number.POSITIVE_INFINITY;
    this.abilityDuration = 1;
    this.abilityCooldown = 2.2 + this.id * 1.1;
    this.abilityEffectApplied = true;
    this.abilityImpactPulse = 0;
    this.abilityTarget.set(0, 0, 0);
    this.shockwaveLife = 0;
    this.knockbackVelocity.set(0, 0, 0);
    this.defeatImpulse.set(0, 0, 0);
    this.group.visible = true;
    this.group.scale.setScalar(1);
    this.healthFill.scale.x = 1;
    this.rig.resetPose();
    this.clearAbilityEffects();
  }

  private createFireBreathLine(): THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]),
      new THREE.LineBasicMaterial({
        color: 0x8befff,
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending,
      }),
    );
    line.visible = false;
    return line;
  }

  private createFireBreathBeam(
    color: number,
    opacity: number,
  ): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 18, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    mesh.visible = false;
    return mesh;
  }

  private createFireBreathImpact(): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 18, 12),
      new THREE.MeshBasicMaterial({
        color: 0x9befff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    mesh.visible = false;
    return mesh;
  }

  private createShockwaveMesh(): THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial> {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.035, 8, 96),
      new THREE.MeshBasicMaterial({
        color: 0xe8b870,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.visible = false;
    return mesh;
  }

  private createTailSpikePool(): void {
    for (let index = 0; index < TAIL_SPIKE_POOL_SIZE; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.ConeGeometry(1.05, 5.8, 6),
        new THREE.MeshStandardMaterial({
          color: 0x263334,
          roughness: 0.76,
          metalness: 0.06,
        }),
      );
      mesh.visible = false;
      mesh.castShadow = true;
      this.abilityEffects.add(mesh);
      this.tailSpikes.push({
        mesh,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
      });
    }
  }

  private clearAbilityEffects(): void {
    this.hideFireBreath();
    this.shockwaveLife = 0;
    this.shockwaveMesh.visible = false;
    for (const spike of this.tailSpikes) {
      spike.life = 0;
      spike.mesh.visible = false;
      spike.position.set(0, 0, 0);
      spike.velocity.set(0, 0, 0);
    }
  }

  private hideFireBreath(): void {
    this.fireBreathLine.visible = false;
    this.fireBreathCore.visible = false;
    this.fireBreathHalo.visible = false;
    this.fireBreathImpact.visible = false;
    this.fireBreathLight.intensity = 0;
  }

  update(
    delta: number,
    city: City,
    player: Player,
    camera: THREE.Camera,
    coldEnvironment?: ColdEnvironment,
  ): EnemySmashEvent[] {
    const smashEvents: EnemySmashEvent[] = [];

    if (this.defeated) {
      this.updateRagdoll(delta);
      return smashEvents;
    }

    this.cold.update(delta, coldEnvironment);
    this.attackTimer = Math.max(0, this.attackTimer - delta);
    this.sprintHitCooldown = Math.max(0, this.sprintHitCooldown - delta);
    this.abilityCooldown = Math.max(0, this.abilityCooldown - delta);
    this.stompTimer += delta;
    this.updateTailSpikeProjectiles(delta, city, smashEvents);
    this.updateShockwaveVisual(delta);

    if (this.stunnedTimer > 0) {
      this.updateStunned(delta, city, player, camera);
      return smashEvents;
    }

    const targetBuilding = city.getNearestStandingBuilding(this.position, 260);
    if (targetBuilding) {
      TARGET.copy(targetBuilding.position);
    } else {
      TARGET.copy(player.position);
      TARGET.y = 0;
    }

    const attackRange = targetBuilding ? this.radius + Math.max(targetBuilding.halfX, targetBuilding.halfZ) + 3.5 : 8;
    const distance = horizontalDistance(this.position, TARGET);
    const frozen = this.cold.frozen;
    let moving = false;

    if (
      targetBuilding &&
      !frozen &&
      !this.activeAbility &&
      !this.attackKind &&
      this.abilityCooldown <= 0 &&
      this.shouldUseAbility(distance, attackRange)
    ) {
      this.startAbility(targetBuilding);
    }

    if (this.activeAbility) {
      this.faceAbilityTarget();
    } else if (distance > attackRange && !frozen) {
      MOVE.copy(TARGET).sub(this.position);
      MOVE.y = 0;
      MOVE.normalize();
      const speed = this.speed * this.cold.slowMultiplier(0.78);
      this.position.addScaledVector(MOVE, speed * delta);
      this.group.rotation.y = Math.atan2(MOVE.x, MOVE.z);
      moving = true;
    } else if (targetBuilding && this.attackTimer <= 0 && !frozen) {
      this.attack(targetBuilding);
    }

    if (this.knockbackVelocity.lengthSq() > 0.01) {
      this.position.addScaledVector(this.knockbackVelocity, delta);
      this.position.x = clamp(this.position.x, -ENEMY_WORLD_LIMIT, ENEMY_WORLD_LIMIT);
      this.position.z = clamp(this.position.z, -ENEMY_WORLD_LIMIT, ENEMY_WORLD_LIMIT);
      this.knockbackVelocity.multiplyScalar(Math.max(0, 1 - delta * ENEMY_KNOCKBACK_DAMPING));
      moving = true;
    }

    this.position.y = city.getTerrainHeightAt(this.position.x, this.position.z);
    const attackEvent = this.updateAttackDamage(delta, city);
    if (attackEvent) {
      smashEvents.push(attackEvent);
    }
    this.movingAmount = damp(this.movingAmount, moving ? 1 : 0, 7, delta);
    this.group.position.copy(this.position);
    this.updateActiveAbility(delta, city, smashEvents);
    this.animate(delta, camera);
    return smashEvents;
  }

  takeDamage(amount: number, impulse?: THREE.Vector3): void {
    if (this.defeated) {
      return;
    }

    this.health = Math.max(0, this.health - amount);
    this.healthFill.scale.x = Math.max(0.001, this.health / this.maxHealth);
    if (this.health <= 0) {
      this.defeat(impulse);
    }
  }

  applyFrost(amount: number): void {
    this.applyCold(amount);
  }

  applyCold(amount: number): void {
    if (!this.defeated) {
      this.cold.add(amount);
    }
  }

  warm(amount: number): void {
    if (!this.defeated) {
      this.cold.warm(amount);
    }
  }

  createSnapshot(): EnemySnapshot {
    return {
      id: this.id,
      position: [this.position.x, this.position.y, this.position.z],
      yaw: this.group.rotation.y,
      health: this.health,
      cold: this.cold.value,
      defeated: this.defeated,
    };
  }

  applySnapshot(snapshot: EnemySnapshot): void {
    this.position.set(snapshot.position[0], snapshot.position[1], snapshot.position[2]);
    this.health = Math.max(0, snapshot.health);
    this.cold.reset(snapshot.cold);
    this.defeated = snapshot.defeated;
    this.group.position.copy(this.position);
    this.group.rotation.y = snapshot.yaw;
    this.group.visible = !snapshot.defeated;
    this.healthFill.scale.x = Math.max(0.001, this.health / this.maxHealth);
    this.bodyMaterial.color.lerpColors(this.kaijuClass.bodyColor, this.kaijuClass.coldColor, this.cold.value * 0.78);
    this.clearAbilityEffects();
  }

  trySprintHit(playerPosition: THREE.Vector3, playerVelocity: THREE.Vector3): boolean {
    if (this.defeated) {
      return false;
    }

    const speed = playerVelocity.length();
    if (speed < PLAYER_SPRINT_ENEMY_MIN_SPEED) {
      return false;
    }

    if (Math.abs(playerPosition.y - PLAYER_SPRINT_ENEMY_CENTER_Y) > PLAYER_SPRINT_ENEMY_VERTICAL_RADIUS) {
      return false;
    }

    const reach = this.radius + PLAYER_SPRINT_ENEMY_RADIUS;
    if (horizontalDistance(this.position, playerPosition) > reach) {
      return false;
    }

    if (this.stunnedTimer > 0) {
      this.refreshStunCarry(playerVelocity);
      return true;
    }

    if (this.sprintHitCooldown > 0) {
      return false;
    }

    RAM_DIRECTION.set(playerVelocity.x, 0, playerVelocity.z);
    if (RAM_DIRECTION.lengthSq() < 0.001) {
      RAM_DIRECTION.copy(this.position).sub(playerPosition);
      RAM_DIRECTION.y = 0;
    }
    if (RAM_DIRECTION.lengthSq() < 0.001) {
      RAM_DIRECTION.set(0, 0, -1);
    }
    RAM_DIRECTION.normalize();

    const hitStrength = PLAYER_SPRINT_ENEMY_KNOCKBACK_BASE + speed * PLAYER_SPRINT_ENEMY_KNOCKBACK_SPEED_SCALE;
    const hitImpulse = RAM_DIRECTION.clone().multiplyScalar(hitStrength);
    hitImpulse.y = DEFEAT_RAGDOLL_UPWARD_IMPULSE;
    this.takeDamage(PLAYER_SPRINT_ENEMY_DAMAGE_BASE + speed * PLAYER_SPRINT_ENEMY_DAMAGE_SPEED_SCALE, hitImpulse);
    this.sprintHitCooldown = PLAYER_SPRINT_ENEMY_HIT_COOLDOWN;

    if (!this.defeated) {
      this.knockbackVelocity.addScaledVector(RAM_DIRECTION, hitStrength);
      this.group.rotation.y = Math.atan2(RAM_DIRECTION.x, RAM_DIRECTION.z);
      this.attackKind = null;
      this.attackTarget = null;
      this.attackDamageApplied = true;
      this.startStunned(playerVelocity, hitImpulse);
      this.attackTimer = Math.max(this.attackTimer, PLAYER_SPRINT_ENEMY_HIT_COOLDOWN);
      this.movingAmount = 1;
    }

    return true;
  }

  private startStunned(playerVelocity: THREE.Vector3, hitImpulse: THREE.Vector3): void {
    const speed = playerVelocity.length();
    this.stunnedTimer = clamp(
      LIVE_RAGDOLL_STUN_BASE + speed * LIVE_RAGDOLL_STUN_SPEED_SCALE,
      LIVE_RAGDOLL_STUN_BASE,
      LIVE_RAGDOLL_STUN_MAX,
    );
    this.refreshStunCarry(playerVelocity);
    this.stunnedCarryVelocity.addScaledVector(hitImpulse, LIVE_RAGDOLL_KNOCKBACK_CARRY_SCALE);
    this.knockbackVelocity.set(0, 0, 0);
    this.attackKind = null;
    this.attackTarget = null;
    this.attackDamageApplied = true;
    this.activeAbility = null;
    this.abilityEffectApplied = true;
    this.abilityCooldown = Math.max(this.abilityCooldown, 1.2);
    this.clearAbilityEffects();
    this.rig.startStunnedRagdoll(hitImpulse);
  }

  private refreshStunCarry(playerVelocity: THREE.Vector3): void {
    STUN_PLAYER_CARRY.copy(playerVelocity).multiplyScalar(LIVE_RAGDOLL_PLAYER_CARRY_SCALE);
    this.stunnedCarryVelocity.lerp(STUN_PLAYER_CARRY, 0.58);
  }

  private updateStunned(delta: number, city: City, player: Player, camera: THREE.Camera): void {
    this.stunnedTimer = Math.max(0, this.stunnedTimer - delta);

    if (player.boostActive && player.velocity.length() >= PLAYER_SPRINT_ENEMY_MIN_SPEED * 0.55) {
      STUN_PLAYER_CARRY.copy(player.velocity).multiplyScalar(LIVE_RAGDOLL_PLAYER_CARRY_SCALE);
      this.stunnedCarryVelocity.lerp(STUN_PLAYER_CARRY, 1 - Math.exp(-7.2 * delta));
    } else {
      this.stunnedCarryVelocity.multiplyScalar(Math.exp(-LIVE_RAGDOLL_CARRY_DAMPING * delta));
    }

    STUN_DISPLACEMENT.copy(this.stunnedCarryVelocity).multiplyScalar(delta);
    this.position.add(STUN_DISPLACEMENT);
    this.position.x = clamp(this.position.x, -ENEMY_WORLD_LIMIT, ENEMY_WORLD_LIMIT);
    this.position.z = clamp(this.position.z, -ENEMY_WORLD_LIMIT, ENEMY_WORLD_LIMIT);
    this.group.position.copy(this.position);
    this.rig.translateRagdoll(STUN_DISPLACEMENT);
    this.rig.updateRagdoll(delta);
    this.syncPositionWithStunnedRagdoll(city);
    this.updateStunnedVisual(camera);

    if (this.stunnedTimer <= 0) {
      this.recoverFromStun(city);
    }
  }

  private updateStunnedVisual(camera: THREE.Camera): void {
    const cold = this.cold.value;
    this.bodyMaterial.color.lerpColors(this.kaijuClass.bodyColor, this.kaijuClass.coldColor, cold * 0.78);
    this.healthFill.parent?.lookAt(camera.position);
    this.healthFill.parent?.rotateY(Math.PI);
    this.healthFill.parent?.scale.setScalar(1 + Math.sin(performance.now() * 0.004 + this.id) * 0.012);
    this.group.updateMatrixWorld(true);
  }

  private syncPositionWithStunnedRagdoll(city: City): void {
    if (!this.rig.isRagdollActive()) {
      return;
    }

    this.rig.getRagdollRootPosition(STUN_RAGDOLL_ROOT);
    this.position.x = clamp(STUN_RAGDOLL_ROOT.x, -ENEMY_WORLD_LIMIT, ENEMY_WORLD_LIMIT);
    this.position.z = clamp(STUN_RAGDOLL_ROOT.z, -ENEMY_WORLD_LIMIT, ENEMY_WORLD_LIMIT);
    this.position.y = city.getTerrainHeightAt(this.position.x, this.position.z);
    this.group.position.copy(this.position);
    this.rig.syncRagdollPose();
  }

  private recoverFromStun(city: City): void {
    this.stunnedTimer = 0;
    this.stunnedCarryVelocity.set(0, 0, 0);
    this.position.y = city.getTerrainHeightAt(this.position.x, this.position.z);
    this.group.position.copy(this.position);
    this.group.rotation.z = 0;
    this.rig.resetPose();
    this.attackTimer = Math.max(this.attackTimer, 0.38);
    this.movingAmount = 0;
  }

  private attack(targetBuilding: Building): void {
    const kinds = this.kaijuClass.attackOrder;
    this.attackKind = kinds[(this.attackCounter + this.id) % kinds.length];
    this.attackCounter += 1;
    this.attackDuration = getAttackSpec(this.attackKind).duration + this.id * 0.04;
    this.attackElapsed = 0;
    this.attackTimer = this.attackDuration + 0.34 + this.id * 0.08;
    this.attackTarget = targetBuilding;
    this.attackDamageApplied = false;
  }

  private defeat(impulse?: THREE.Vector3): void {
    this.defeated = true;
    this.stunnedTimer = 0;
    this.stunnedCarryVelocity.set(0, 0, 0);
    this.attackKind = null;
    this.attackTarget = null;
    this.attackDamageApplied = true;
    this.activeAbility = null;
    this.abilityEffectApplied = true;
    this.attackTimer = Number.POSITIVE_INFINITY;
    this.group.visible = true;
    this.clearAbilityEffects();
    this.defeatImpulse.copy(impulse ?? this.knockbackVelocity);
    if (this.defeatImpulse.lengthSq() < 0.001) {
      this.defeatImpulse.set(Math.sin(this.id + this.stompTimer) * 18, DEFEAT_RAGDOLL_UPWARD_IMPULSE, Math.cos(this.id) * 18);
    } else {
      this.defeatImpulse.y += DEFEAT_RAGDOLL_UPWARD_IMPULSE;
    }
    this.rig.startRagdoll(this.defeatImpulse);
  }

  updateRagdoll(delta: number): void {
    if (!this.rig.isRagdollActive()) {
      return;
    }

    this.rig.updateRagdoll(delta);
    this.group.updateMatrixWorld(true);
  }

  private updateAttackDamage(delta: number, city: City): EnemySmashEvent | null {
    if (!this.attackKind || this.attackElapsed >= this.attackDuration) {
      return null;
    }

    this.attackElapsed = Math.min(this.attackDuration, this.attackElapsed + delta);
    const spec = getAttackSpec(this.attackKind);
    let smashEvent: EnemySmashEvent | null = null;
    if (!this.attackDamageApplied && this.attackElapsed >= spec.impactTime) {
      let primaryDamage = 0;
      if (this.attackTarget) {
        const previousHealth = this.attackTarget.health;
        city.damageBuilding(this.attackTarget, spec.buildingDamage + this.id * 4, this.position);
        primaryDamage = Math.max(0, previousHealth - this.attackTarget.health);
      }
      const splashHits = city.damageNear(this.position, this.radius + spec.splashRadius, spec.splashDamage + this.id * 2);
      smashEvent = {
        kind: this.attackKind,
        position: (this.attackTarget?.position ?? this.position).clone(),
        intensity: clamp(0.75 + primaryDamage / 42 + splashHits * 0.08 + this.id * 0.12, 0.85, 1.85),
      };
      this.attackDamageApplied = true;
    }

    if (this.attackElapsed >= this.attackDuration) {
      this.attackKind = null;
      this.attackTarget = null;
      this.attackDamageApplied = true;
    }

    return smashEvent;
  }

  private shouldUseAbility(distance: number, attackRange: number): boolean {
    if (this.kaijuClass.ability === "tail-spikes") {
      return distance > attackRange * 1.15 && distance < 170;
    }

    if (this.kaijuClass.ability === "fire-breath") {
      return distance > 22 && distance < FIRE_BREATH_RANGE;
    }

    return distance < SHOCKWAVE_RADIUS + 18;
  }

  private startAbility(targetBuilding: Building): void {
    this.activeAbility = this.kaijuClass.ability;
    this.abilityElapsed = 0;
    this.abilityEffectApplied = false;
    this.abilityImpactPulse = 0;
    this.attackTimer = Math.max(this.attackTimer, 0.8);
    this.attackKind = null;
    this.attackTarget = null;
    this.attackDamageApplied = true;
    this.abilityTarget.set(
      targetBuilding.position.x,
      targetBuilding.baseY + Math.min(targetBuilding.height * 0.62, 34),
      targetBuilding.position.z,
    );

    if (this.activeAbility === "fire-breath") {
      this.abilityDuration = 1.45;
    } else if (this.activeAbility === "shockwave") {
      this.abilityDuration = 1.08;
    } else {
      this.abilityDuration = 0.78;
    }
  }

  private updateActiveAbility(delta: number, city: City, smashEvents: EnemySmashEvent[]): void {
    if (!this.activeAbility) {
      this.hideFireBreath();
      return;
    }

    this.abilityElapsed = Math.min(this.abilityDuration, this.abilityElapsed + delta);

    if (this.activeAbility === "fire-breath") {
      this.updateFireBreath(delta, city, smashEvents);
    } else {
      this.hideFireBreath();
    }

    if (this.activeAbility === "tail-spikes" && !this.abilityEffectApplied && this.abilityElapsed >= 0.36) {
      this.launchTailSpikes();
      this.abilityEffectApplied = true;
    }

    if (this.activeAbility === "shockwave" && !this.abilityEffectApplied && this.abilityElapsed >= 0.52) {
      const damaged = city.damageNear(this.position, SHOCKWAVE_RADIUS, SHOCKWAVE_DAMAGE + this.id * 3);
      this.emitShockwave();
      smashEvents.push({
        kind: "stomp",
        position: this.position.clone(),
        intensity: clamp(1 + damaged * 0.08 + this.id * 0.12, 1, 1.85),
      });
      this.abilityEffectApplied = true;
    }

    if (this.abilityElapsed >= this.abilityDuration) {
      this.finishAbility();
    }
  }

  private finishAbility(): void {
    const completed = this.activeAbility;
    this.activeAbility = null;
    this.abilityElapsed = Number.POSITIVE_INFINITY;
    this.abilityEffectApplied = true;
    this.hideFireBreath();

    if (completed === "fire-breath") {
      this.abilityCooldown = 7.4 + this.id * 0.45;
    } else if (completed === "shockwave") {
      this.abilityCooldown = 8.2 + this.id * 0.55;
    } else {
      this.abilityCooldown = 6.2 + this.id * 0.4;
    }
  }

  private faceAbilityTarget(): void {
    ABILITY_DIRECTION.copy(this.abilityTarget).sub(this.position);
    ABILITY_DIRECTION.y = 0;
    if (ABILITY_DIRECTION.lengthSq() > 0.001) {
      ABILITY_DIRECTION.normalize();
      this.group.rotation.y = Math.atan2(ABILITY_DIRECTION.x, ABILITY_DIRECTION.z);
    }
  }

  private updateFireBreath(delta: number, city: City, smashEvents: EnemySmashEvent[]): void {
    this.getAbilityOrigin(ABILITY_ORIGIN, 20, 8);
    ABILITY_DIRECTION.copy(this.abilityTarget).sub(ABILITY_ORIGIN);
    if (ABILITY_DIRECTION.lengthSq() < 0.001) {
      ABILITY_DIRECTION.set(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
    }
    ABILITY_DIRECTION.normalize();

    let range = FIRE_BREATH_RANGE;
    let hitPosition = ABILITY_END.copy(ABILITY_ORIGIN).addScaledVector(ABILITY_DIRECTION, range);
    let hitCityTarget: CityDamageTarget | null = null;
    const buildingHit = city.raycastBuildings(ABILITY_ORIGIN, ABILITY_DIRECTION, range);
    if (buildingHit) {
      range = buildingHit.along;
      hitPosition = ABILITY_END.copy(buildingHit.point);
      hitCityTarget = buildingHit.target;
    } else if (ABILITY_DIRECTION.y < -0.02) {
      const terrainDistance = city.raycastTerrainDistance(ABILITY_ORIGIN, ABILITY_DIRECTION, range);
      if (terrainDistance !== null) {
        range = terrainDistance;
        hitPosition = ABILITY_END.copy(ABILITY_ORIGIN).addScaledVector(ABILITY_DIRECTION, range);
      }
    }

    if (hitCityTarget) {
      city.damageTarget(hitCityTarget, FIRE_BREATH_DAMAGE_RATE * delta, hitPosition);
      const splashHits = city.damageNear(hitPosition, FIRE_BREATH_SPLASH_RADIUS, FIRE_BREATH_SPLASH_DAMAGE_RATE * delta);
      this.abilityImpactPulse -= delta;
      if (this.abilityImpactPulse <= 0) {
        smashEvents.push({
          kind: "bite",
          position: hitPosition.clone(),
          intensity: clamp(0.95 + splashHits * 0.04, 0.95, 1.35),
        });
        this.abilityImpactPulse = 0.34;
      }
    }

    this.fireBreathLine.geometry.setFromPoints([ABILITY_ORIGIN, hitPosition]);
    this.fireBreathLine.visible = true;
    this.placeBeamMesh(this.fireBreathCore, ABILITY_ORIGIN, hitPosition, 0.92);
    this.placeBeamMesh(this.fireBreathHalo, ABILITY_ORIGIN, hitPosition, 2.7);
    this.fireBreathCore.visible = true;
    this.fireBreathHalo.visible = true;
    this.fireBreathImpact.visible = true;
    this.fireBreathImpact.position.copy(hitPosition);
    this.fireBreathImpact.scale.setScalar(hitCityTarget ? 1.2 + Math.sin(performance.now() * 0.04) * 0.18 : 0.56);
    this.fireBreathImpact.material.opacity = hitCityTarget ? 0.86 : 0.38;
    this.fireBreathLight.position.copy(hitPosition);
    this.fireBreathLight.intensity = hitCityTarget ? 68 : 20;
  }

  private launchTailSpikes(): void {
    this.getAbilityOrigin(ABILITY_ORIGIN, 12, -8);
    ABILITY_DIRECTION.copy(this.abilityTarget).sub(ABILITY_ORIGIN);
    if (ABILITY_DIRECTION.lengthSq() < 0.001) {
      ABILITY_DIRECTION.set(Math.sin(this.group.rotation.y), 0.08, Math.cos(this.group.rotation.y));
    }
    ABILITY_DIRECTION.normalize();

    TAIL_RIGHT.crossVectors(ABILITY_DIRECTION, ABILITY_UP);
    if (TAIL_RIGHT.lengthSq() < 0.001) {
      TAIL_RIGHT.set(1, 0, 0);
    }
    TAIL_RIGHT.normalize();

    for (const spread of [-0.22, 0, 0.22]) {
      const spike = this.getTailSpike();
      const direction = spike.velocity
        .copy(ABILITY_DIRECTION)
        .addScaledVector(TAIL_RIGHT, spread)
        .addScaledVector(ABILITY_UP, 0.04)
        .normalize();
      spike.position.copy(ABILITY_ORIGIN).addScaledVector(TAIL_RIGHT, spread * 7);
      spike.velocity.copy(direction).multiplyScalar(TAIL_SPIKE_SPEED);
      spike.life = TAIL_SPIKE_LIFE;
      spike.maxLife = TAIL_SPIKE_LIFE;
      spike.mesh.visible = true;
      spike.mesh.position.copy(spike.position);
      spike.mesh.quaternion.setFromUnitVectors(ABILITY_UP, direction);
      spike.mesh.scale.setScalar(1);
    }
  }

  private updateTailSpikeProjectiles(delta: number, city: City, smashEvents: EnemySmashEvent[]): void {
    for (const spike of this.tailSpikes) {
      if (spike.life <= 0) {
        continue;
      }

      spike.life = Math.max(0, spike.life - delta);
      if (spike.life <= 0) {
        spike.mesh.visible = false;
        continue;
      }

      spike.velocity.y -= 9.8 * delta;
      spike.position.addScaledVector(spike.velocity, delta);
      spike.mesh.position.copy(spike.position);
      spike.mesh.quaternion.setFromUnitVectors(ABILITY_UP, spike.velocity.clone().normalize());
      spike.mesh.scale.setScalar(0.72 + (spike.life / spike.maxLife) * 0.34);

      let hitBuilding: Building | null = null;
      for (const building of city.buildings) {
        if (!building.destroyed && distanceToBuildingVolume(spike.position, building) <= TAIL_SPIKE_HIT_RADIUS) {
          hitBuilding = building;
          break;
        }
      }

      const terrainY = city.getTerrainHeightAt(spike.position.x, spike.position.z);
      if (hitBuilding) {
        city.damageBuilding(hitBuilding, 24 + this.id * 2, spike.position);
        const splashHits = city.damageNear(spike.position, 8.5, 7);
        smashEvents.push({
          kind: "swipe",
          position: spike.position.clone(),
          intensity: clamp(0.82 + splashHits * 0.05, 0.82, 1.22),
        });
        spike.life = 0;
        spike.mesh.visible = false;
      } else if (spike.position.y <= terrainY + 0.9) {
        const splashHits = city.damageNear(spike.position, 10, 8);
        if (splashHits > 0) {
          smashEvents.push({
            kind: "swipe",
            position: spike.position.clone(),
            intensity: clamp(0.75 + splashHits * 0.04, 0.75, 1.12),
          });
        }
        spike.life = 0;
        spike.mesh.visible = false;
      }
    }
  }

  private emitShockwave(): void {
    this.shockwaveLife = SHOCKWAVE_LIFE;
    this.shockwaveMaxLife = SHOCKWAVE_LIFE;
    this.shockwaveMesh.visible = true;
    this.shockwaveMesh.position.set(this.position.x, this.position.y + 0.35, this.position.z);
    this.shockwaveMesh.scale.setScalar(0.01);
    this.shockwaveMesh.material.opacity = 0.82;
  }

  private updateShockwaveVisual(delta: number): void {
    if (this.shockwaveLife <= 0) {
      this.shockwaveMesh.visible = false;
      return;
    }

    this.shockwaveLife = Math.max(0, this.shockwaveLife - delta);
    const age = 1 - this.shockwaveLife / Math.max(0.001, this.shockwaveMaxLife);
    const eased = age * age * (3 - 2 * age);
    const radius = lerp(4, SHOCKWAVE_RADIUS, eased);
    this.shockwaveMesh.scale.set(radius, radius, radius);
    this.shockwaveMesh.material.opacity = (1 - age) * 0.82;
    this.shockwaveMesh.visible = this.shockwaveLife > 0;
  }

  private placeBeamMesh(
    mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>,
    origin: THREE.Vector3,
    end: THREE.Vector3,
    radius: number,
  ): void {
    const length = origin.distanceTo(end);
    ABILITY_MIDPOINT.copy(origin).lerp(end, 0.5);
    ABILITY_DIRECTION.copy(end).sub(origin);
    if (ABILITY_DIRECTION.lengthSq() < 0.001) {
      ABILITY_DIRECTION.set(0, 1, 0);
    }
    ABILITY_DIRECTION.normalize();
    mesh.position.copy(ABILITY_MIDPOINT);
    mesh.quaternion.setFromUnitVectors(ABILITY_UP, ABILITY_DIRECTION);
    mesh.scale.set(radius, length, radius);
    mesh.material.opacity = mesh === this.fireBreathCore ? 0.78 + Math.sin(performance.now() * 0.04) * 0.08 : 0.24;
  }

  private getAbilityOrigin(target: THREE.Vector3, height: number, forwardOffset: number): THREE.Vector3 {
    const forward = ABILITY_DIRECTION.set(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
    return target.copy(this.position).addScaledVector(forward, forwardOffset).setY(this.position.y + height);
  }

  private getTailSpike(): TailSpikeProjectile {
    let best = this.tailSpikes[0];
    for (const spike of this.tailSpikes) {
      if (spike.life <= 0) {
        return spike;
      }
      if (spike.life < best.life) {
        best = spike;
      }
    }
    return best;
  }

  private getPoseAttackKind(): KaijuAttackKind | null {
    if (this.activeAbility === "tail-spikes") {
      return "swipe";
    }

    if (this.activeAbility === "fire-breath") {
      return "bite";
    }

    if (this.activeAbility === "shockwave") {
      return "stomp";
    }

    return this.attackKind;
  }

  private animate(delta: number, camera: THREE.Camera): void {
    const poseAttackKind = this.getPoseAttackKind();
    const attackProgress =
      this.activeAbility !== null
        ? this.abilityElapsed / Math.max(0.001, this.abilityDuration)
        : this.attackKind
          ? this.attackElapsed / Math.max(0.001, this.attackDuration)
          : 1;
    const cold = this.cold.value;
    this.group.scale.y = 1 + Math.sin(this.stompTimer * 3.2) * 0.018 * (1 - cold);
    this.rig.updatePose({
      time: this.stompTimer + this.id * 0.33,
      movingAmount: this.movingAmount,
      freeze: cold,
      attackKind: poseAttackKind,
      attackProgress,
    });

    this.bodyMaterial.color.lerpColors(this.kaijuClass.bodyColor, this.kaijuClass.coldColor, cold * 0.78);
    this.healthFill.parent?.lookAt(camera.position);
    this.healthFill.parent?.rotateY(Math.PI);
    this.healthFill.parent?.scale.setScalar(1 + Math.sin(performance.now() * 0.004 + this.id) * 0.012);
    this.group.rotation.z = Math.sin(this.stompTimer * 2.7 + this.id) * 0.025 * (1 - cold);

    if (cold > 0.65) {
      this.group.rotation.z += Math.sin(performance.now() * 0.016) * 0.008;
    }

    this.group.updateMatrixWorld();
    this.group.position.y += Math.sin(this.stompTimer * 7.2) * 0.04 * (1 - cold);
  }
}

function getAttackSpec(kind: KaijuAttackKind): {
  duration: number;
  impactTime: number;
  buildingDamage: number;
  splashRadius: number;
  splashDamage: number;
} {
  if (kind === "swipe") {
    return { duration: 1.05, impactTime: 0.58, buildingDamage: 30, splashRadius: 7.5, splashDamage: 7 };
  }

  if (kind === "bite") {
    return { duration: 0.92, impactTime: 0.48, buildingDamage: 38, splashRadius: 4.5, splashDamage: 5 };
  }

  return { duration: 1.18, impactTime: 0.64, buildingDamage: 42, splashRadius: 6, splashDamage: 10 };
}

function distanceToBuildingVolume(point: THREE.Vector3, building: Building): number {
  const currentHeight = building.height * Math.max(0.16, building.mesh.scale.y);
  const centerY = building.baseY + currentHeight * 0.5;
  const dx = Math.max(Math.abs(point.x - building.position.x) - building.halfX, 0);
  const dy = Math.max(Math.abs(point.y - centerY) - currentHeight * 0.5, 0);
  const dz = Math.max(Math.abs(point.z - building.position.z) - building.halfZ, 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class EnemyManager {
  private readonly enemies: Enemy[] = [];
  private readonly spawns = [
    new THREE.Vector3(-196, 0, -182),
    new THREE.Vector3(188, 0, -162),
    new THREE.Vector3(170, 0, 190),
  ];

  constructor(private readonly scene: THREE.Scene) {
    for (let index = 0; index < DEFAULT_KAIJU_CLASSES.length; index += 1) {
      const enemy = new Enemy(this.scene, index, this.spawns[index], DEFAULT_KAIJU_CLASSES[index]);
      this.enemies.push(enemy);
      this.scene.add(enemy.group);
    }
  }

  reset(city: City): void {
    for (let index = 0; index < this.enemies.length; index += 1) {
      const spawn = this.spawns[index].clone();
      spawn.x += randomRange(() => ((index + 3) % 7) / 7, -8, 8);
      spawn.y = city.getTerrainHeightAt(spawn.x, spawn.z);
      this.enemies[index].reset(spawn);
    }
  }

  update(
    delta: number,
    city: City,
    player: Player | readonly Player[],
    camera: THREE.Camera,
    coldEnvironment?: ColdEnvironment,
  ): EnemySmashEvent[] {
    const smashEvents: EnemySmashEvent[] = [];
    const players = Array.isArray(player) ? player : [player];
    for (const enemy of this.enemies) {
      const targetPlayer = this.getNearestPlayer(enemy.position, players);
      smashEvents.push(...enemy.update(delta, city, targetPlayer, camera, coldEnvironment));
    }
    return smashEvents;
  }

  updateRagdolls(delta: number): void {
    for (const enemy of this.enemies) {
      if (enemy.defeated) {
        enemy.updateRagdoll(delta);
      }
    }
  }

  applyPlayerSprintImpact(player: Player): void {
    if (!player.boostActive) {
      return;
    }

    for (const enemy of this.enemies) {
      enemy.trySprintHit(player.position, player.velocity);
    }
  }

  applyPlayersSprintImpact(players: Iterable<Player>): void {
    for (const player of players) {
      this.applyPlayerSprintImpact(player);
    }
  }

  createSnapshot(): EnemySnapshot[] {
    return this.enemies.map((enemy) => enemy.createSnapshot());
  }

  applySnapshot(snapshot: readonly EnemySnapshot[]): void {
    for (const enemyState of snapshot) {
      this.enemies[enemyState.id]?.applySnapshot(enemyState);
    }
  }

  getAlive(): Enemy[] {
    return this.enemies.filter((enemy) => !enemy.defeated);
  }

  getAverageCold(): number {
    const alive = this.getAlive();
    if (alive.length === 0) {
      return 0;
    }

    return alive.reduce((sum, enemy) => sum + enemy.cold.value, 0) / alive.length;
  }

  remaining(): number {
    return this.getAlive().length;
  }

  private getNearestPlayer(position: THREE.Vector3, players: readonly Player[]): Player {
    let nearest = players[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const player of players) {
      const distance = horizontalDistance(position, player.position);
      if (distance < nearestDistance) {
        nearest = player;
        nearestDistance = distance;
      }
    }

    return nearest;
  }
}

export type { Enemy };
