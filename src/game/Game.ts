import * as THREE from "three";
import { City } from "./City";
import { EnemyManager } from "./Enemies";
import { Hud } from "./Hud";
import { InputController } from "./Input";
import { damp } from "./math";
import { Player } from "./Player";
import { PowerSystem } from "./Powers";
import { SceneController } from "./Scene";
import { SoundSystem } from "./SoundSystem";
import { SpeedLines } from "./SpeedLines";
import type { GamePhase, HudSnapshot, PowerSnapshot } from "./types";

const CITY_DAMAGE_LIMIT = 0.6;
const CAMERA_FORWARD = new THREE.Vector3();
const CAMERA_TARGET = new THREE.Vector3();
const CAMERA_POSITION = new THREE.Vector3();
const CAMERA_RELATIVE_UP = new THREE.Vector3();

export class Game {
  private readonly sceneController: SceneController;
  private readonly input: InputController;
  private readonly hud: Hud;
  private readonly city: City;
  private readonly player: Player;
  private readonly enemies: EnemyManager;
  private readonly powers: PowerSystem;
  private readonly sound: SoundSystem;
  private readonly speedLines: SpeedLines;
  private readonly clock = new THREE.Clock();

  private phase: GamePhase = "start";
  private animationFrame = 0;
  private elapsed = 0;
  private lastPowerSnapshot: PowerSnapshot = {
    heatActive: false,
    frostActive: false,
    heatStatus: "Ready",
    frostStatus: "Ready",
  };

  constructor(root: HTMLElement) {
    this.sceneController = new SceneController(root);
    this.input = new InputController(root);
    this.hud = new Hud(this.handlePrimaryAction);
    this.city = new City(this.sceneController.scene);
    this.player = new Player(this.sceneController.scene);
    this.enemies = new EnemyManager(this.sceneController.scene);
    this.powers = new PowerSystem(this.sceneController.scene);
    this.sound = new SoundSystem();
    this.speedLines = new SpeedLines(this.sceneController.camera);

    this.createAtmosphere();
    this.resetWorld();
    window.addEventListener("resize", this.onResize);
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.onResize);
    this.input.dispose();
    this.sound.dispose();
    this.sceneController.dispose();
  }

  private readonly tick = (): void => {
    this.animationFrame = requestAnimationFrame(this.tick);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += delta;

    if (this.input.consumePrimaryAction() && this.phase !== "playing") {
      this.handlePrimaryAction();
    }

    if (this.input.consumeRestart()) {
      this.sound.resume();
      this.resetWorld();
      this.phase = "playing";
      this.input.requestPointerLock();
    }

    if (this.phase === "playing") {
      this.updatePlaying(delta);
    } else {
      this.input.consumeMouseDelta();
      this.updateIdleCamera(delta);
      this.speedLines.update(delta, false, 0);
      this.sound.update({ heatActive: false, frostActive: false, boostActive: false, speedRatio: 0 });
    }

    this.city.update(delta);
    this.hud.update(this.createHudSnapshot());
    this.sceneController.render();
  };

  private updatePlaying(delta: number): void {
    this.player.update(delta, this.input);
    this.lastPowerSnapshot = this.powers.update(delta, this.input, this.player, this.enemies, this.city);
    this.enemies.update(delta, this.city, this.player, this.sceneController.camera);
    this.updateChaseCamera(delta);
    const speedRatio = this.player.velocity.length() / 112;
    this.speedLines.update(delta, this.player.boostActive, speedRatio);
    this.sound.update({
      heatActive: this.lastPowerSnapshot.heatActive,
      frostActive: this.lastPowerSnapshot.frostActive,
      boostActive: this.player.boostActive,
      speedRatio,
    });

    const cityDamage = this.city.getDamageRatio();
    if (this.enemies.remaining() === 0) {
      this.phase = "win";
      this.input.exitPointerLock();
      this.input.clearCombatInputs();
    } else if (cityDamage >= CITY_DAMAGE_LIMIT) {
      this.phase = "lose";
      this.input.exitPointerLock();
      this.input.clearCombatInputs();
    }
  }

  private updateChaseCamera(delta: number): void {
    const camera = this.sceneController.camera;
    const forward = this.player.getForward(CAMERA_FORWARD);
    const chaseDistance = this.player.boostActive ? 19 : 26;
    const cameraRise = this.player.boostActive ? 15.5 : 9.5;
    CAMERA_POSITION.copy(this.player.position).addScaledVector(forward, -chaseDistance);
    CAMERA_POSITION.y += cameraRise;
    CAMERA_RELATIVE_UP.copy(camera.up).applyQuaternion(camera.quaternion).normalize();
    CAMERA_POSITION.addScaledVector(CAMERA_RELATIVE_UP, this.player.boostActive ? 4.8 : 0);
    CAMERA_TARGET.copy(this.player.position).addScaledVector(forward, this.player.boostActive ? 58 : 34);
    CAMERA_TARGET.y += this.player.boostActive ? 7.2 : 3.4;

    camera.position.lerp(CAMERA_POSITION, 1 - Math.exp(-7.2 * delta));
    camera.lookAt(CAMERA_TARGET);
    camera.fov = damp(camera.fov, this.player.boostActive ? 94 : 68, 6.6, delta);
    camera.updateProjectionMatrix();
  }

  private updateIdleCamera(delta: number): void {
    const camera = this.sceneController.camera;
    const orbit = this.elapsed * 0.08;
    CAMERA_POSITION.set(Math.sin(orbit) * 176, 92, Math.cos(orbit) * 176);
    CAMERA_TARGET.set(0, 26, 0);
    camera.position.lerp(CAMERA_POSITION, 1 - Math.exp(-1.8 * delta));
    camera.lookAt(CAMERA_TARGET);
    camera.fov = damp(camera.fov, 62, 2.4, delta);
    camera.updateProjectionMatrix();
  }

  private handlePrimaryAction = (): void => {
    if (this.phase === "playing") {
      return;
    }

    this.sound.resume();
    this.resetWorld();
    this.phase = "playing";
    this.input.requestPointerLock();
  };

  private resetWorld(): void {
    this.city.reset();
    this.player.reset();
    this.enemies.reset();
    this.powers.reset();
    this.sound.reset();
    this.lastPowerSnapshot = {
      heatActive: false,
      frostActive: false,
      heatStatus: "Ready",
      frostStatus: "Ready",
    };
  }

  private createHudSnapshot(): HudSnapshot {
    const cityDamage = this.city.getDamageRatio();
    const phaseCopy = this.getPhaseCopy();

    return {
      phase: this.phase,
      cityDamage,
      cityLimit: CITY_DAMAGE_LIMIT,
      energy: this.player.energy,
      monstersRemaining: this.enemies.remaining(),
      heatActive: this.lastPowerSnapshot.heatActive,
      frostActive: this.lastPowerSnapshot.frostActive,
      boostActive: this.player.boostActive,
      heatStatus: this.lastPowerSnapshot.heatStatus,
      frostStatus: this.lastPowerSnapshot.frostStatus,
      speedStatus: this.player.boostStatus,
      ...phaseCopy,
    };
  }

  private getPhaseCopy(): Pick<HudSnapshot, "messageTitle" | "messageCopy" | "actionLabel"> {
    if (this.phase === "win") {
      return {
        messageTitle: "City secure",
        messageCopy: "The monsters are down. Caldera City is battered, but the skyline is still standing.",
        actionLabel: "Fly again",
      };
    }

    if (this.phase === "lose") {
      return {
        messageTitle: "City breach",
        messageCopy: "Too much of the city fell before the monsters were stopped. Reset the sortie and cut them off earlier.",
        actionLabel: "Retry sortie",
      };
    }

    if (this.phase === "playing") {
      return {
        messageTitle: "Defend Caldera City",
        messageCopy: "Break every monster before city destruction reaches 60%.",
        actionLabel: "In flight",
      };
    }

    return {
      messageTitle: "Defend Caldera City",
      messageCopy: "Fly through the downtown canyons, break the rampaging monsters, and keep destruction below 60%.",
      actionLabel: "Start sortie",
    };
  }

  private createAtmosphere(): void {
    const scene = this.sceneController.scene;

    const hazeMaterial = new THREE.MeshBasicMaterial({
      color: 0xdbe7ec,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    for (let ring = 0; ring < 3; ring += 1) {
      const cloudBand = new THREE.Mesh(new THREE.TorusGeometry(145 + ring * 58, 1.8, 6, 80), hazeMaterial);
      cloudBand.position.y = 82 + ring * 22;
      cloudBand.rotation.x = Math.PI / 2;
      cloudBand.rotation.z = ring * 0.7;
      scene.add(cloudBand);
    }

    const boundaryMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });

    for (let index = 0; index < 24; index += 1) {
      const marker = new THREE.Mesh(new THREE.BoxGeometry(1.4, 36, 1.4), boundaryMaterial);
      const angle = (index / 24) * Math.PI * 2;
      marker.position.set(Math.cos(angle) * 236, 18, Math.sin(angle) * 236);
      marker.rotation.y = -angle;
      scene.add(marker);
    }
  }

  private readonly onResize = (): void => {
    this.sceneController.resize();
  };
}
