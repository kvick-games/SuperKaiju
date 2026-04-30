import * as THREE from "three";
import { LobbyClient, getLobbyIdFromLocation } from "../multiplayer/LobbyClient";
import { RemoteInputController } from "../multiplayer/RemoteInputController";
import type {
  GameSnapshot,
  LobbyPlayer,
  NetworkMode,
  PlayerId,
  PlayerInputState,
  PlayerSnapshot,
} from "../multiplayer/protocol";
import { MULTIPLAYER_PROTOCOL_VERSION } from "../multiplayer/protocol";
import { City } from "./City";
import type { CityLayoutPlan } from "./CityLayout";
import { EnemyManager } from "./Enemies";
import { Hud } from "./Hud";
import { InputController } from "./Input";
import { clamp, damp, horizontalDistance, rightFromYaw } from "./math";
import { Player } from "./Player";
import { PowerSystem } from "./Powers";
import { SceneController } from "./Scene";
import { SoundSystem } from "./SoundSystem";
import { SpeedLines } from "./SpeedLines";
import type { GamePhase, HudSnapshot, PowerSnapshot, WeatherSnapshot } from "./types";
import { WeatherSystem } from "./Weather";

const CITY_DAMAGE_LIMIT = 0.6;
const SNAPSHOT_RATE_SECONDS = 1 / 20;
const INPUT_RATE_SECONDS = 1 / 30;
const CAMERA_FORWARD = new THREE.Vector3();
const CAMERA_RIGHT = new THREE.Vector3();
const CAMERA_TARGET = new THREE.Vector3();
const CAMERA_POSITION = new THREE.Vector3();
const CAMERA_IDLE_SPEED_THRESHOLD = 0.45;
const CAMERA_CLOSE_SHOULDER_DISTANCE = 3.2;
const CAMERA_CLOSE_SHOULDER_RISE = 1.35;
const CAMERA_CLOSE_SHOULDER_SIDE = 0.72;
const CAMERA_CLOSE_TARGET_DISTANCE = 7.5;
const CAMERA_CLOSE_TARGET_RISE = 1.05;
const CAMERA_CLOSE_FOV = 54;
const CAMERA_NORMAL_DISTANCE = 7.2;
const CAMERA_NORMAL_RISE = 2.65;
const CAMERA_NORMAL_TARGET_DISTANCE = 13;
const CAMERA_NORMAL_TARGET_RISE = 1.75;
const CAMERA_NORMAL_FOV = 58;
const CAMERA_CHASE_POSITION_SMOOTHING = 3.4;
const CAMERA_CHASE_FOV_SMOOTHING = 3.2;
const DAMAGE_SOUND_NEAR_GAIN = 0.78;
const DAMAGE_SOUND_MIN_GAIN = 0.08;
const DAMAGE_SOUND_FULL_GAIN_DISTANCE = 34;
const DAMAGE_SOUND_MAX_DISTANCE = 220;
const LEVEL_COMPLETE_DELAY = 3;

export interface GameOptions {
  cityLayout?: CityLayoutPlan | null;
  networkSession?: LobbyClient | null;
}

export class Game {
  private readonly sceneController: SceneController;
  private readonly input: InputController;
  private readonly hud: Hud;
  private readonly city: City;
  private readonly enemies: EnemyManager;
  private readonly sound: SoundSystem;
  private readonly speedLines: SpeedLines;
  private readonly weather: WeatherSystem;
  private readonly clock = new THREE.Clock();
  private readonly players = new Map<PlayerId, Player>();
  private readonly playerNames = new Map<PlayerId, string>();
  private readonly playerPowers = new Map<PlayerId, PowerSystem>();
  private readonly playerPowerSnapshots = new Map<PlayerId, PowerSnapshot>();
  private readonly remoteInputs = new Map<PlayerId, RemoteInputController>();

  private networkMode: NetworkMode = "offline";
  private networkSession: LobbyClient | null = null;
  private localPlayerId: PlayerId = "local";
  private lobbyPlayers: LobbyPlayer[] = [];
  private lobbyStatus = "Solo sortie ready";
  private inviteUrl: string | null = null;
  private phase: GamePhase = "start";
  private animationFrame = 0;
  private elapsed = 0;
  private levelCompleteElapsed = 0;
  private worldSeed = createWorldSeed();
  private inputSequence = 0;
  private snapshotSequence = 0;
  private inputElapsed = 0;
  private snapshotElapsed = 0;
  private latestSnapshot: GameSnapshot | null = null;
  private lastPowerSnapshot: PowerSnapshot = createDefaultPowerSnapshot();
  private lastWeatherSnapshot: WeatherSnapshot = {
    kind: "sunny",
    label: "Sunny",
    coldRate: 0,
    thawRate: 0.075,
    progress: 0,
  };

  constructor(root: HTMLElement, private readonly options: GameOptions = {}) {
    this.sceneController = new SceneController(root);
    this.input = new InputController(root);
    this.city = new City(this.sceneController.scene);
    this.addPlayer(this.localPlayerId, "Pilot");
    this.enemies = new EnemyManager(this.sceneController.scene);
    this.sound = new SoundSystem();
    this.speedLines = new SpeedLines(this.sceneController.scene, this.sceneController.camera);
    this.weather = new WeatherSystem(this.sceneController.scene);
    this.hud = new Hud({
      onPrimaryAction: this.handlePrimaryAction,
      onHostLobby: this.handleHostLobby,
      onJoinLobby: this.handleJoinLobby,
      onCopyInvite: this.handleCopyInvite,
    });

    this.createAtmosphere();
    this.resetWorld(this.worldSeed);
    window.addEventListener("resize", this.onResize);
    this.animationFrame = requestAnimationFrame(this.tick);

    const linkedLobby = getLobbyIdFromLocation();
    if (linkedLobby) {
      void this.joinLobby(linkedLobby);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.onResize);
    this.networkSession?.disconnect();
    this.input.dispose();
    this.sound.dispose();
    this.weather.dispose();
    this.sceneController.dispose();
  }

  private readonly tick = (): void => {
    this.animationFrame = requestAnimationFrame(this.tick);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += delta;

    if (this.input.consumePrimaryAction() && (this.phase === "start" || this.phase === "win" || this.phase === "lose")) {
      this.handlePrimaryAction();
    }

    if (this.input.consumeRestart() && this.networkMode !== "client") {
      this.startRun(createWorldSeed(), true);
    }

    if (this.networkMode === "client" && this.phase !== "start") {
      this.updateClientPlaying(delta);
    } else if (this.phase === "playing") {
      this.updatePlaying(delta);
    } else if (this.phase === "level-complete") {
      this.updateLevelComplete(delta);
    } else {
      this.input.consumeMouseDelta();
      this.updateIdleCamera(delta);
      this.enemies.updateRagdolls(delta);
      this.speedLines.update(delta, false, 0);
      this.sound.update({ heatActive: false, frostActive: false, boostActive: false, speedRatio: 0, fireIntensity: 0 });
    }

    const followPlayer = this.getLocalPlayer();
    if (this.networkMode === "client" && this.phase !== "start") {
      this.weather.update(delta, followPlayer.position);
      this.city.update(delta, this.lastWeatherSnapshot);
    } else {
      this.lastWeatherSnapshot = this.weather.update(delta, followPlayer.position);
      this.city.update(delta, this.lastWeatherSnapshot);
    }

    this.publishHostSnapshot(delta);
    this.hud.update(this.createHudSnapshot());
    this.sceneController.render();
  };

  private updatePlaying(delta: number): void {
    const activePlayers = this.getActivePlayers();
    let localSprintBuildingImpacts = 0;

    for (const [playerId, player] of this.players) {
      if (!player.group.visible) {
        continue;
      }

      const input = playerId === this.localPlayerId ? this.input : this.remoteInputs.get(playerId);
      const powers = this.playerPowers.get(playerId);
      if (!input || !powers) {
        continue;
      }

      const sprintBuildingImpacts = player.update(delta, input, this.city);
      const powerSnapshot = powers.update(delta, input, player, this.enemies, this.city);
      this.playerPowerSnapshots.set(playerId, powerSnapshot);
      if (playerId === this.localPlayerId) {
        localSprintBuildingImpacts = sprintBuildingImpacts;
        this.lastPowerSnapshot = powerSnapshot;
      }
    }

    this.enemies.applyPlayersSprintImpact(activePlayers);
    const enemySmashes = this.enemies.update(
      delta,
      this.city,
      activePlayers,
      this.sceneController.camera,
      this.lastWeatherSnapshot,
    );
    for (const smash of enemySmashes) {
      this.sound.playEnemyBuildingSmash(smash.intensity, this.getDamageSoundGain(smash.position));
    }
    for (const event of this.city.consumeSoundEvents()) {
      if (event.type === "building-collapse") {
        this.sound.playBuildingCollapse(event.intensity, this.getDamageSoundGain(event.position));
      }
    }

    const localPlayer = this.getLocalPlayer();
    this.updateChaseCamera(delta, localPlayer);
    const speedRatio = localPlayer.velocity.length() / 112;
    if (localSprintBuildingImpacts > 0) {
      this.sound.playBuildingImpact(speedRatio);
    }
    this.speedLines.update(delta, localPlayer.boostActive, speedRatio);
    this.sound.update({
      heatActive: this.lastPowerSnapshot.heatActive,
      frostActive: this.lastPowerSnapshot.frostActive,
      boostActive: localPlayer.boostActive,
      speedRatio,
      fireIntensity: this.lastPowerSnapshot.fireIntensity,
    });

    const cityDamage = this.city.getDamageRatio();
    if (this.enemies.remaining() === 0) {
      this.startLevelCompleteTransition();
    } else if (cityDamage >= CITY_DAMAGE_LIMIT) {
      this.phase = "lose";
      this.input.exitPointerLock();
      this.input.clearCombatInputs();
    }
  }

  private updateClientPlaying(delta: number): void {
    this.inputElapsed += delta;
    if (this.inputElapsed >= INPUT_RATE_SECONDS) {
      this.inputElapsed = 0;
      this.networkSession?.sendInput(this.input.createNetworkInputState(this.inputSequence));
      this.inputSequence += 1;
    }

    if (this.latestSnapshot) {
      this.applyGameSnapshot(this.latestSnapshot);
      this.latestSnapshot = null;
    }

    this.updateReplicatedPowerVisuals(delta);

    const localPlayer = this.getLocalPlayer();
    this.updateChaseCamera(delta, localPlayer);
    const speedRatio = localPlayer.velocity.length() / 112;
    this.speedLines.update(delta, localPlayer.boostActive, speedRatio);
    this.sound.update({
      heatActive: this.lastPowerSnapshot.heatActive,
      frostActive: this.lastPowerSnapshot.frostActive,
      boostActive: localPlayer.boostActive,
      speedRatio,
      fireIntensity: this.lastPowerSnapshot.fireIntensity,
    });
  }

  private startLevelCompleteTransition(): void {
    this.phase = "level-complete";
    this.levelCompleteElapsed = 0;
    this.input.clearCombatInputs();
    this.sound.update({ heatActive: false, frostActive: false, boostActive: false, speedRatio: 0, fireIntensity: 0 });
    this.sound.playLevelCompleteJingle();
  }

  private updateLevelComplete(delta: number): void {
    this.levelCompleteElapsed += delta;
    this.input.consumeMouseDelta();
    this.enemies.updateRagdolls(delta);
    const localPlayer = this.getLocalPlayer();
    localPlayer.boostActive = false;
    localPlayer.rechargeEnergy(0.16 * delta);
    this.speedLines.update(delta, false, 0);
    this.sound.update({ heatActive: false, frostActive: false, boostActive: false, speedRatio: 0, fireIntensity: 0 });
    this.updateLevelCompleteCamera(delta, localPlayer);

    if (this.levelCompleteElapsed >= LEVEL_COMPLETE_DELAY) {
      this.phase = "win";
      this.input.exitPointerLock();
      this.input.clearCombatInputs();
    }
  }

  private updateChaseCamera(delta: number, player: Player): void {
    const camera = this.sceneController.camera;
    const forward = player.getForward(CAMERA_FORWARD);
    const idleShoulderCamera =
      !player.boostActive && player.velocity.lengthSq() <= CAMERA_IDLE_SPEED_THRESHOLD * CAMERA_IDLE_SPEED_THRESHOLD;
    const closeShoulderCamera = player.boostActive || idleShoulderCamera;
    const chaseDistance = closeShoulderCamera ? CAMERA_CLOSE_SHOULDER_DISTANCE : CAMERA_NORMAL_DISTANCE;
    const cameraRise = closeShoulderCamera ? CAMERA_CLOSE_SHOULDER_RISE : CAMERA_NORMAL_RISE;
    CAMERA_POSITION.copy(player.position).addScaledVector(forward, -chaseDistance);
    CAMERA_POSITION.y += cameraRise;
    if (closeShoulderCamera) {
      CAMERA_POSITION.addScaledVector(rightFromYaw(player.yaw, CAMERA_RIGHT), CAMERA_CLOSE_SHOULDER_SIDE);
    }
    CAMERA_TARGET.copy(player.position).addScaledVector(
      forward,
      closeShoulderCamera ? CAMERA_CLOSE_TARGET_DISTANCE : CAMERA_NORMAL_TARGET_DISTANCE,
    );
    CAMERA_TARGET.y += closeShoulderCamera ? CAMERA_CLOSE_TARGET_RISE : CAMERA_NORMAL_TARGET_RISE;

    camera.position.lerp(CAMERA_POSITION, 1 - Math.exp(-CAMERA_CHASE_POSITION_SMOOTHING * delta));
    camera.lookAt(CAMERA_TARGET);
    camera.fov = damp(camera.fov, closeShoulderCamera ? CAMERA_CLOSE_FOV : CAMERA_NORMAL_FOV, CAMERA_CHASE_FOV_SMOOTHING, delta);
    camera.updateProjectionMatrix();
  }

  private getDamageSoundGain(sourcePosition: THREE.Vector3): number {
    const distance = horizontalDistance(this.getLocalPlayer().position, sourcePosition);
    const range = DAMAGE_SOUND_MAX_DISTANCE - DAMAGE_SOUND_FULL_GAIN_DISTANCE;
    const distanceRatio = clamp((distance - DAMAGE_SOUND_FULL_GAIN_DISTANCE) / range, 0, 1);
    const falloff = 1 - distanceRatio;
    return DAMAGE_SOUND_NEAR_GAIN * (DAMAGE_SOUND_MIN_GAIN + (1 - DAMAGE_SOUND_MIN_GAIN) * falloff * falloff);
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

  private updateLevelCompleteCamera(delta: number, player: Player): void {
    const camera = this.sceneController.camera;
    const progress = clamp(this.levelCompleteElapsed / LEVEL_COMPLETE_DELAY, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    const forward = player.getForward(CAMERA_FORWARD);
    CAMERA_POSITION.copy(player.position).addScaledVector(forward, -28 - eased * 32);
    CAMERA_POSITION.y += 13 + eased * 30;
    CAMERA_TARGET.copy(player.position).addScaledVector(forward, 24 * (1 - eased));
    CAMERA_TARGET.y += 5 + eased * 12;

    camera.position.lerp(CAMERA_POSITION, 1 - Math.exp(-2.8 * delta));
    camera.lookAt(CAMERA_TARGET);
    camera.fov = damp(camera.fov, 58, 2.6, delta);
    camera.updateProjectionMatrix();
  }

  private handlePrimaryAction = (): void => {
    if (this.phase === "playing" || this.phase === "level-complete" || this.networkMode === "client") {
      return;
    }

    const seed = createWorldSeed();
    this.startRun(seed, true);
    if (this.networkMode === "host") {
      this.networkSession?.sendStart(seed);
    }
  };

  private readonly handleHostLobby = (): void => {
    if (this.networkMode !== "offline" || this.phase !== "start") {
      return;
    }

    void this.hostLobby();
  };

  private readonly handleJoinLobby = (): void => {
    if (this.networkMode !== "offline" || this.phase !== "start") {
      return;
    }

    const lobbyId = getLobbyIdFromLocation() ?? parseLobbyId(window.prompt("Paste the lobby invite link") ?? "");
    if (lobbyId) {
      void this.joinLobby(lobbyId);
    }
  };

  private readonly handleCopyInvite = (): void => {
    if (!this.inviteUrl) {
      return;
    }

    navigator.clipboard
      ?.writeText(this.inviteUrl)
      .then(() => {
        this.lobbyStatus = "Invite link copied";
      })
      .catch(() => {
        this.lobbyStatus = this.inviteUrl ?? "Invite link unavailable";
      });
  };

  private async hostLobby(): Promise<void> {
    this.lobbyStatus = "Creating lobby";
    try {
      const session = await LobbyClient.host(this.hud.getPlayerName(), this.createLobbyHandlers());
      this.networkSession = session;
      this.inviteUrl = session.inviteUrl;
      this.networkMode = "host";
      this.lobbyStatus = this.formatLobbyStatus(session.players);
    } catch (error) {
      this.networkMode = "offline";
      this.networkSession = null;
      this.lobbyStatus = error instanceof Error ? error.message : "Could not create lobby";
    }
  }

  private async joinLobby(lobbyId: string): Promise<void> {
    this.lobbyStatus = "Joining lobby";
    try {
      const session = await LobbyClient.join(lobbyId, this.hud.getPlayerName(), this.createLobbyHandlers());
      this.networkSession = session;
      this.inviteUrl = null;
      this.networkMode = "client";
      this.lobbyStatus = this.formatLobbyStatus(session.players);
    } catch (error) {
      this.networkMode = "offline";
      this.networkSession = null;
      this.lobbyStatus = error instanceof Error ? error.message : "Could not join lobby";
    }
  }

  private createLobbyHandlers() {
    return {
      onJoined: (details: { playerId: PlayerId; role: "host" | "client"; players: LobbyPlayer[] }) => {
        this.networkMode = details.role;
        this.setLocalPlayerId(details.playerId, this.hud.getPlayerName());
        this.syncRosterPlayers(details.players);
      },
      onRoster: (players: LobbyPlayer[]) => {
        this.syncRosterPlayers(players);
        if (this.networkMode !== "offline") {
          this.lobbyStatus = this.formatLobbyStatus(players);
        }
      },
      onStart: (worldSeed: number, players: LobbyPlayer[]) => {
        this.syncRosterPlayers(players);
        if (this.phase !== "playing") {
          this.startRun(worldSeed, this.networkMode !== "client");
        }
      },
      onInput: (playerId: PlayerId, input: PlayerInputState) => {
        if (this.networkMode !== "host") {
          return;
        }

        this.remoteInputs.get(playerId)?.applyState(input);
      },
      onSnapshot: (snapshot: GameSnapshot) => {
        if (this.networkMode === "client") {
          this.latestSnapshot = snapshot;
        }
      },
      onClosed: (reason: string) => {
        this.lobbyStatus = reason;
        this.networkMode = "offline";
        this.networkSession = null;
        this.inviteUrl = null;
        this.lobbyPlayers = [];
        this.input.exitPointerLock();
        this.phase = "start";
      },
      onError: (reason: string) => {
        this.lobbyStatus = reason;
      },
      onStatus: (status: string) => {
        this.lobbyStatus = status;
      },
    };
  }

  private startRun(seed: number, requestPointerLock: boolean): void {
    this.sound.resume();
    this.resetWorld(seed);
    this.phase = "playing";
    this.lobbyStatus = this.networkMode === "offline" ? "Solo sortie active" : "Co-op sortie active";
    if (requestPointerLock) {
      this.input.requestPointerLock();
    }
  }

  private resetWorld(seed: number): void {
    this.worldSeed = seed;
    this.city.reset(this.options.cityLayout, seed);
    this.syncRosterPlayers(this.getCurrentRoster());
    this.getCurrentRoster().forEach((entry, index) => {
      this.players.get(entry.id)?.reset(index);
      this.playerPowers.get(entry.id)?.reset();
      this.playerPowerSnapshots.set(entry.id, createDefaultPowerSnapshot());
    });
    this.enemies.reset(this.city);
    this.sound.reset();
    this.weather.reset();
    this.levelCompleteElapsed = 0;
    this.lastWeatherSnapshot = this.weather.getSnapshot();
    this.lastPowerSnapshot = createDefaultPowerSnapshot();
    this.snapshotElapsed = 0;
    this.inputElapsed = 0;
  }

  private publishHostSnapshot(delta: number): void {
    if (this.networkMode !== "host" || !this.networkSession || this.phase === "start") {
      return;
    }

    this.snapshotElapsed += delta;
    if (this.snapshotElapsed < SNAPSHOT_RATE_SECONDS) {
      return;
    }

    this.snapshotElapsed = 0;
    this.networkSession.sendSnapshot(this.createGameSnapshot());
  }

  private createGameSnapshot(): GameSnapshot {
    const players: PlayerSnapshot[] = [];
    for (const [playerId, player] of this.players) {
      if (!player.group.visible) {
        continue;
      }

      const power = this.playerPowerSnapshots.get(playerId) ?? createDefaultPowerSnapshot();
      players.push(
        player.createSnapshot(playerId, this.playerNames.get(playerId) ?? "Pilot", {
          heatActive: power.heatActive,
          frostActive: power.frostActive,
          heatStatus: power.heatStatus,
          frostStatus: power.frostStatus,
        }),
      );
    }

    return {
      protocol: MULTIPLAYER_PROTOCOL_VERSION,
      sequence: this.snapshotSequence++,
      worldSeed: this.worldSeed,
      phase: this.phase,
      elapsed: this.elapsed,
      cityDamage: this.city.getDamageRatio(),
      cityLimit: CITY_DAMAGE_LIMIT,
      coldLevel: Math.max(this.city.getAverageCold(), this.enemies.getAverageCold()),
      monstersRemaining: this.enemies.remaining(),
      weather: this.lastWeatherSnapshot,
      players,
      enemies: this.enemies.createSnapshot(),
      city: this.city.createSnapshot(),
    };
  }

  private applyGameSnapshot(snapshot: GameSnapshot): void {
    if (snapshot.worldSeed !== this.worldSeed) {
      this.resetWorld(snapshot.worldSeed);
    }

    this.phase = snapshot.phase;
    this.elapsed = snapshot.elapsed;
    this.lastWeatherSnapshot = snapshot.weather;
    this.weather.applySnapshot(snapshot.weather);
    this.city.applySnapshot(snapshot.city);
    this.enemies.applySnapshot(snapshot.enemies);

    const visiblePlayerIds = new Set<PlayerId>();
    for (const playerSnapshot of snapshot.players) {
      visiblePlayerIds.add(playerSnapshot.id);
      const player = this.addPlayer(playerSnapshot.id, playerSnapshot.name);
      player.applySnapshot(playerSnapshot);
      this.playerPowerSnapshots.set(playerSnapshot.id, {
        heatActive: playerSnapshot.heatActive,
        frostActive: playerSnapshot.frostActive,
        fireIntensity: 0,
        heatStatus: playerSnapshot.heatStatus,
        frostStatus: playerSnapshot.frostStatus,
      });
      if (playerSnapshot.id === this.localPlayerId) {
        this.lastPowerSnapshot = this.playerPowerSnapshots.get(playerSnapshot.id) ?? createDefaultPowerSnapshot();
      }
    }

    for (const [playerId, player] of this.players) {
      if (!visiblePlayerIds.has(playerId)) {
        player.setVisible(false);
      }
    }

    if (snapshot.phase === "win" || snapshot.phase === "lose") {
      this.input.exitPointerLock();
      this.input.clearCombatInputs();
    }
  }

  private updateReplicatedPowerVisuals(delta: number): void {
    const inactivePower = createDefaultPowerSnapshot();
    for (const [playerId, player] of this.players) {
      const powers = this.playerPowers.get(playerId);
      if (!powers) {
        continue;
      }

      const snapshot =
        this.phase === "playing" && player.group.visible
          ? (this.playerPowerSnapshots.get(playerId) ?? inactivePower)
          : inactivePower;
      const rendered = powers.renderSnapshot(delta, player, snapshot, this.enemies, this.city);
      this.playerPowerSnapshots.set(playerId, rendered);
      if (playerId === this.localPlayerId) {
        this.lastPowerSnapshot = rendered;
      }
    }
  }

  private createHudSnapshot(): HudSnapshot {
    const cityDamage = this.city.getDamageRatio();
    const phaseCopy = this.getPhaseCopy();
    const localPlayer = this.getLocalPlayer();
    const localPower = this.playerPowerSnapshots.get(this.localPlayerId) ?? this.lastPowerSnapshot;

    return {
      phase: this.phase,
      cityDamage,
      cityLimit: CITY_DAMAGE_LIMIT,
      coldLevel: Math.max(this.city.getAverageCold(), this.enemies.getAverageCold()),
      weather: this.lastWeatherSnapshot,
      energy: localPlayer.energy,
      monstersRemaining: this.enemies.remaining(),
      heatActive: localPower.heatActive,
      frostActive: localPower.frostActive,
      boostActive: localPlayer.boostActive,
      heatStatus: localPower.heatStatus,
      frostStatus: localPower.frostStatus,
      speedStatus: localPlayer.boostStatus,
      multiplayer: {
        mode: this.networkMode,
        status: this.lobbyStatus,
        inviteUrl: this.inviteUrl,
        players: this.getCurrentRoster().filter((player) => player.id !== "local" || this.networkMode === "offline"),
        joined: this.networkMode !== "offline",
        canHost: this.networkMode === "offline" && this.phase === "start",
        canJoin: this.networkMode === "offline" && this.phase === "start",
        canCopyInvite: this.networkMode === "host" && Boolean(this.inviteUrl),
        canStart: this.phase !== "playing" && this.phase !== "level-complete" && this.networkMode !== "client",
      },
      ...phaseCopy,
    };
  }

  private getPhaseCopy(): Pick<HudSnapshot, "messageTitle" | "messageCopy" | "actionLabel"> {
    if (this.phase === "win") {
      return {
        messageTitle: "City secure",
        messageCopy: "The monsters are down. Caldera City is battered, but the skyline is still standing.",
        actionLabel: this.networkMode === "host" ? "Launch again" : "Fly again",
      };
    }

    if (this.phase === "level-complete") {
      return {
        messageTitle: "City secure",
        messageCopy: "Final threat neutralized. Returning to command.",
        actionLabel: "Securing",
      };
    }

    if (this.phase === "lose") {
      return {
        messageTitle: "City breach",
        messageCopy: "Too much of the city fell before the monsters were stopped. Reset the sortie and cut them off earlier.",
        actionLabel: this.networkMode === "host" ? "Relaunch co-op" : "Retry sortie",
      };
    }

    if (this.phase === "playing") {
      return {
        messageTitle: "Defend Caldera City",
        messageCopy: "Break every monster before city destruction reaches 60%.",
        actionLabel: "In flight",
      };
    }

    if (this.networkMode === "client") {
      return {
        messageTitle: "Co-op lobby",
        messageCopy: "Connected to the lobby. The host starts the sortie.",
        actionLabel: "Waiting",
      };
    }

    if (this.networkMode === "host") {
      return {
        messageTitle: "Co-op lobby",
        messageCopy: "Share the invite link, wait for friends, then launch the shared sortie.",
        actionLabel: "Start co-op",
      };
    }

    return {
      messageTitle: "Defend Caldera City",
      messageCopy: "Fly through the downtown canyons, break the rampaging monsters, and keep destruction below 60%.",
      actionLabel: "Start sortie",
    };
  }

  private addPlayer(playerId: PlayerId, name: string): Player {
    const existing = this.players.get(playerId);
    if (existing) {
      this.playerNames.set(playerId, name);
      existing.setVisible(true);
      return existing;
    }

    const player = new Player(this.sceneController.scene);
    const powers = new PowerSystem(this.sceneController.scene);
    this.players.set(playerId, player);
    this.playerNames.set(playerId, name);
    this.playerPowers.set(playerId, powers);
    this.playerPowerSnapshots.set(playerId, createDefaultPowerSnapshot());
    if (playerId !== this.localPlayerId) {
      this.remoteInputs.set(playerId, new RemoteInputController());
    }
    return player;
  }

  private setLocalPlayerId(playerId: PlayerId, name: string): void {
    if (playerId === this.localPlayerId) {
      this.playerNames.set(playerId, name);
      return;
    }

    const player = this.players.get(this.localPlayerId);
    const powers = this.playerPowers.get(this.localPlayerId);
    const snapshot = this.playerPowerSnapshots.get(this.localPlayerId) ?? createDefaultPowerSnapshot();
    if (player && powers && !this.players.has(playerId)) {
      this.players.delete(this.localPlayerId);
      this.playerPowers.delete(this.localPlayerId);
      this.playerPowerSnapshots.delete(this.localPlayerId);
      this.playerNames.delete(this.localPlayerId);
      this.players.set(playerId, player);
      this.playerPowers.set(playerId, powers);
      this.playerPowerSnapshots.set(playerId, snapshot);
    } else {
      this.addPlayer(playerId, name);
    }

    this.remoteInputs.delete(playerId);
    this.localPlayerId = playerId;
    this.playerNames.set(playerId, name);
  }

  private syncRosterPlayers(players: LobbyPlayer[]): void {
    this.lobbyPlayers = players;
    const activeIds = new Set(players.map((player) => player.id));
    for (const player of players) {
      this.addPlayer(player.id, player.name);
      if (player.id !== this.localPlayerId && this.networkMode === "host" && !this.remoteInputs.has(player.id)) {
        this.remoteInputs.set(player.id, new RemoteInputController());
      }
    }

    for (const [playerId, player] of this.players) {
      if (playerId !== this.localPlayerId && this.networkMode !== "offline" && !activeIds.has(playerId)) {
        player.setVisible(false);
        this.remoteInputs.get(playerId)?.clear();
      }
    }
  }

  private getCurrentRoster(): LobbyPlayer[] {
    if (this.lobbyPlayers.length > 0) {
      return this.lobbyPlayers;
    }

    return [
      {
        id: this.localPlayerId,
        name: this.playerNames.get(this.localPlayerId) ?? "Pilot",
        role: this.networkMode === "client" ? "client" : "host",
        connected: true,
      },
    ];
  }

  private formatLobbyStatus(players: LobbyPlayer[] = this.getCurrentRoster()): string {
    const connectedCount = players.filter((player) => player.connected).length;
    const noun = connectedCount === 1 ? "pilot" : "pilots";
    if (this.networkMode === "host") {
      return `${connectedCount} ${noun} in lobby`;
    }

    if (this.networkMode === "client") {
      return `Connected - ${connectedCount} ${noun} in lobby`;
    }

    return "Solo sortie ready";
  }

  private getActivePlayers(): Player[] {
    const players: Player[] = [];
    for (const entry of this.getCurrentRoster()) {
      const player = this.players.get(entry.id);
      if (player?.group.visible) {
        players.push(player);
      }
    }

    return players.length > 0 ? players : [this.getLocalPlayer()];
  }

  private getLocalPlayer(): Player {
    const player = this.players.get(this.localPlayerId) ?? this.players.values().next().value;
    if (!player) {
      throw new Error("No local player is available.");
    }

    return player;
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

function createDefaultPowerSnapshot(): PowerSnapshot {
  return {
    heatActive: false,
    frostActive: false,
    fireIntensity: 0,
    heatStatus: "Ready",
    frostStatus: "Ready",
  };
}

function createWorldSeed(): number {
  const time = Date.now() >>> 0;
  const entropy = Math.floor(Math.random() * 0xffffffff) >>> 0;
  return (time ^ entropy) >>> 0;
}

function parseLobbyId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return url.searchParams.get("lobby")?.toLowerCase() ?? null;
  } catch {
    return trimmed.toLowerCase();
  }
}
