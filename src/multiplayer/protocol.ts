import type { GamePhase, WeatherSnapshot } from "../game/types";

export const MULTIPLAYER_PROTOCOL_VERSION = 1;
export const MAX_LOBBY_PLAYERS = 4;

export type LobbyId = string;
export type PlayerId = string;
export type NetworkMode = "offline" | "host" | "client";
export type LobbyRole = "host" | "client";

export interface LobbyPlayer {
  id: PlayerId;
  name: string;
  role: LobbyRole;
  connected: boolean;
}

export interface LobbyCreatedResponse {
  lobbyId: LobbyId;
  hostToken: string;
  inviteUrl: string;
}

export interface PlayerInputState {
  sequence: number;
  keys: string[];
  mouseButtons: number[];
  mouseDeltaX: number;
  mouseDeltaY: number;
}

export interface PlayerSnapshot {
  id: PlayerId;
  name: string;
  position: [number, number, number];
  velocity: [number, number, number];
  yaw: number;
  pitch: number;
  energy: number;
  boostActive: boolean;
  boostStatus: string;
  heatActive: boolean;
  frostActive: boolean;
  heatStatus: string;
  frostStatus: string;
  visible: boolean;
}

export interface EnemySnapshot {
  id: number;
  position: [number, number, number];
  yaw: number;
  health: number;
  cold: number;
  defeated: boolean;
}

export interface CityBuildingSnapshot {
  id: number;
  health: number;
  cold: number;
  destroyed: boolean;
  severed: boolean;
  scaleY: number;
  positionY: number;
}

export interface CityDamageDelta {
  buildings: CityBuildingSnapshot[];
}

export interface GameSnapshot {
  protocol: typeof MULTIPLAYER_PROTOCOL_VERSION;
  sequence: number;
  worldSeed: number;
  phase: GamePhase;
  elapsed: number;
  cityDamage: number;
  cityLimit: number;
  coldLevel: number;
  monstersRemaining: number;
  weather: WeatherSnapshot;
  players: PlayerSnapshot[];
  enemies: EnemySnapshot[];
  city: CityDamageDelta;
}

export type ClientToRelayMessage =
  | {
      type: "client:join";
      protocol: typeof MULTIPLAYER_PROTOCOL_VERSION;
      role: LobbyRole;
      playerName: string;
      hostToken?: string;
    }
  | {
      type: "client:input";
      input: PlayerInputState;
    }
  | {
      type: "host:start";
      worldSeed: number;
    }
  | {
      type: "host:snapshot";
      snapshot: GameSnapshot;
    }
  | {
      type: "ping";
      sentAt: number;
    };

export type RelayToClientMessage =
  | {
      type: "relay:hello";
      lobbyId: LobbyId;
    }
  | {
      type: "relay:joined";
      lobbyId: LobbyId;
      playerId: PlayerId;
      role: LobbyRole;
      players: LobbyPlayer[];
      started: boolean;
    }
  | {
      type: "relay:roster";
      players: LobbyPlayer[];
      started: boolean;
    }
  | {
      type: "relay:start";
      worldSeed: number;
      players: LobbyPlayer[];
    }
  | {
      type: "relay:input";
      playerId: PlayerId;
      input: PlayerInputState;
    }
  | {
      type: "relay:snapshot";
      snapshot: GameSnapshot;
    }
  | {
      type: "relay:closed";
      reason: string;
    }
  | {
      type: "relay:error";
      reason: string;
    }
  | {
      type: "pong";
      sentAt: number;
      receivedAt: number;
    };

export function sanitizePlayerName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 18) || "Pilot";
}

export function isProtocolMessage(value: unknown): value is { type: string } {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}
