import type { LobbyPlayer, NetworkMode } from "../multiplayer/protocol";

export type GamePhase = "start" | "playing" | "level-complete" | "win" | "lose";
export type WeatherKind = "sunny" | "rain" | "snowy";

export interface WeatherSnapshot {
  kind: WeatherKind;
  label: string;
  coldRate: number;
  thawRate: number;
  progress: number;
}

export interface HudSnapshot {
  phase: GamePhase;
  cityDamage: number;
  cityLimit: number;
  coldLevel: number;
  weather: WeatherSnapshot;
  energy: number;
  monstersRemaining: number;
  heatActive: boolean;
  frostActive: boolean;
  boostActive: boolean;
  heatStatus: string;
  frostStatus: string;
  speedStatus: string;
  messageTitle: string;
  messageCopy: string;
  actionLabel: string;
  multiplayer: MultiplayerHudSnapshot;
}

export interface PowerSnapshot {
  heatActive: boolean;
  frostActive: boolean;
  fireIntensity: number;
  heatStatus: string;
  frostStatus: string;
}

export interface MultiplayerHudSnapshot {
  mode: NetworkMode;
  status: string;
  inviteUrl: string | null;
  players: LobbyPlayer[];
  joined: boolean;
  canHost: boolean;
  canJoin: boolean;
  canCopyInvite: boolean;
  canStart: boolean;
}
