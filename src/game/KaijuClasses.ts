import * as THREE from "three";
import type { KaijuAttackKind, KaijuRigProfile } from "./KaijuRig";

export type KaijuAbilityKind = "tail-spikes" | "fire-breath" | "shockwave";

export interface KaijuClassConfig {
  displayName: string;
  ability: KaijuAbilityKind;
  radius: number;
  maxHealth: number;
  speed: number;
  bodyColor: number;
  coldColor: number;
  rigProfile: KaijuRigProfile;
  attackOrder: readonly KaijuAttackKind[];
}

export abstract class KaijuClass {
  readonly displayName: string;
  readonly ability: KaijuAbilityKind;
  readonly radius: number;
  readonly maxHealth: number;
  readonly speed: number;
  readonly bodyColor: THREE.Color;
  readonly coldColor: THREE.Color;
  readonly rigProfile: KaijuRigProfile;
  readonly attackOrder: readonly KaijuAttackKind[];

  protected constructor(config: KaijuClassConfig) {
    this.displayName = config.displayName;
    this.ability = config.ability;
    this.radius = config.radius;
    this.maxHealth = config.maxHealth;
    this.speed = config.speed;
    this.bodyColor = new THREE.Color(config.bodyColor);
    this.coldColor = new THREE.Color(config.coldColor);
    this.rigProfile = config.rigProfile;
    this.attackOrder = config.attackOrder;
  }

  createBodyMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: this.bodyColor,
      roughness: 0.82,
      metalness: 0.03,
    });
  }
}

export class LizardKaiju extends KaijuClass {
  constructor() {
    super({
      displayName: "Bracken Maw",
      ability: "tail-spikes",
      radius: 9.2,
      maxHealth: 178,
      speed: 13.6,
      bodyColor: 0x43682f,
      coldColor: 0xb8edf2,
      rigProfile: {
        displayName: "Lizard Kaiju",
        bodyPlan: "lizard",
        bellyColor: 0x6b7b54,
        hornColor: 0xe5d4a3,
        clawColor: 0x2a2f2e,
        healthColor: 0xd75d4b,
        bodyScale: [1, 1, 1],
      },
      attackOrder: ["stomp", "swipe", "bite"],
    });
  }
}

export class BlueWolfKaiju extends KaijuClass {
  constructor() {
    super({
      displayName: "Stormfang",
      ability: "fire-breath",
      radius: 8.8,
      maxHealth: 196,
      speed: 16.1,
      bodyColor: 0x245b9d,
      coldColor: 0xd4f6ff,
      rigProfile: {
        displayName: "Blue Wolf Kaiju",
        bodyPlan: "blue-wolf",
        bellyColor: 0x7fb6d9,
        hornColor: 0xc8e7f6,
        clawColor: 0x1b2c44,
        healthColor: 0x4ba3ff,
        bodyScale: [0.94, 1.03, 0.9],
      },
      attackOrder: ["swipe", "bite", "stomp"],
    });
  }
}

export class BrownGorillaKaiju extends KaijuClass {
  constructor() {
    super({
      displayName: "Ironback",
      ability: "shockwave",
      radius: 10.7,
      maxHealth: 255,
      speed: 11.8,
      bodyColor: 0x654026,
      coldColor: 0xcfe8ec,
      rigProfile: {
        displayName: "Brown Gorilla Kaiju",
        bodyPlan: "brown-gorilla",
        bellyColor: 0x8a5a36,
        hornColor: 0x3a2417,
        clawColor: 0x201611,
        healthColor: 0xe0954a,
        bodyScale: [1.16, 1.06, 1.04],
      },
      attackOrder: ["stomp", "swipe", "stomp", "bite"],
    });
  }
}

export const DEFAULT_KAIJU_CLASSES = [new LizardKaiju(), new BlueWolfKaiju(), new BrownGorillaKaiju()] as const;
