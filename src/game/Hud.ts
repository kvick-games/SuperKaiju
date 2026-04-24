import type { HudSnapshot } from "./types";

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required HUD element #${id}`);
  }

  return element as T;
}

export class Hud {
  private readonly hud = requiredElement<HTMLElement>("hud");
  private readonly cityBar = requiredElement<HTMLElement>("city-bar");
  private readonly energyBar = requiredElement<HTMLElement>("energy-bar");
  private readonly cityReadout = requiredElement<HTMLElement>("city-readout");
  private readonly energyReadout = requiredElement<HTMLElement>("energy-readout");
  private readonly monsterReadout = requiredElement<HTMLElement>("monster-readout");
  private readonly heatReadout = requiredElement<HTMLElement>("heat-readout");
  private readonly frostReadout = requiredElement<HTMLElement>("frost-readout");
  private readonly speedReadout = requiredElement<HTMLElement>("speed-readout");
  private readonly messagePanel = requiredElement<HTMLElement>("message-panel");
  private readonly messageTitle = requiredElement<HTMLElement>("message-title");
  private readonly messageCopy = requiredElement<HTMLElement>("message-copy");
  private readonly primaryAction = requiredElement<HTMLButtonElement>("primary-action");

  private lastPhase: HudSnapshot["phase"] | undefined;

  constructor(onPrimaryAction: () => void) {
    this.primaryAction.addEventListener("click", onPrimaryAction);
  }

  update(snapshot: HudSnapshot): void {
    const cityPercent = Math.round(snapshot.cityDamage * 100);
    const limitPercent = Math.round(snapshot.cityLimit * 100);
    const energyPercent = Math.round(snapshot.energy * 100);

    this.cityBar.style.transform = `scaleX(${snapshot.cityDamage.toFixed(3)})`;
    this.cityBar.style.backgroundColor = snapshot.cityDamage > snapshot.cityLimit * 0.72 ? "#d9634f" : "#b84636";
    this.energyBar.style.transform = `scaleX(${snapshot.energy.toFixed(3)})`;

    this.cityReadout.textContent = `${cityPercent}%`;
    this.cityReadout.setAttribute("aria-label", `${cityPercent}% city destruction, limit ${limitPercent}%`);
    this.energyReadout.textContent = `${energyPercent}%`;
    this.monsterReadout.textContent = String(snapshot.monstersRemaining);
    this.heatReadout.textContent = snapshot.heatStatus;
    this.frostReadout.textContent = snapshot.frostStatus;
    this.speedReadout.textContent = snapshot.speedStatus;

    this.hud.classList.toggle("is-heating", snapshot.heatActive);
    this.hud.classList.toggle("is-freezing", snapshot.frostActive);

    if (this.lastPhase !== snapshot.phase) {
      this.messagePanel.classList.toggle("hidden", snapshot.phase === "playing");
      this.lastPhase = snapshot.phase;
    }

    this.messageTitle.textContent = snapshot.messageTitle;
    this.messageCopy.textContent = snapshot.messageCopy;
    this.primaryAction.textContent = snapshot.actionLabel;
  }
}
