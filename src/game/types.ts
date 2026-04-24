export type GamePhase = "start" | "playing" | "win" | "lose";

export interface HudSnapshot {
  phase: GamePhase;
  cityDamage: number;
  cityLimit: number;
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
}

export interface PowerSnapshot {
  heatActive: boolean;
  frostActive: boolean;
  heatStatus: string;
  frostStatus: string;
}
