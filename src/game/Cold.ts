import { clamp } from "./math";

export interface ColdEnvironment {
  coldRate: number;
  thawRate: number;
}

export class ColdComponent {
  value = 0;

  constructor(private readonly defaultThawRate = 0.055) {}

  reset(value = 0): void {
    this.value = clamp(value, 0, 1);
  }

  add(amount: number): void {
    this.value = clamp(this.value + amount, 0, 1);
  }

  warm(amount: number): void {
    this.value = clamp(this.value - amount, 0, 1);
  }

  update(delta: number, environment?: ColdEnvironment): void {
    const coldRate = environment?.coldRate ?? 0;
    if (coldRate > 0) {
      this.add(coldRate * delta);
      return;
    }

    const thawRate = environment?.thawRate ?? this.defaultThawRate;
    this.warm(thawRate * delta);
  }

  get frozen(): boolean {
    return this.value >= 0.92;
  }

  slowMultiplier(maxSlow = 0.78): number {
    return clamp(1 - this.value * maxSlow, 0.08, 1);
  }

  fragilityMultiplier(maxBonus = 0.72): number {
    return 1 + this.value * maxBonus;
  }
}
