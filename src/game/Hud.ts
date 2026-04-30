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
  private readonly coldBar = requiredElement<HTMLElement>("cold-bar");
  private readonly cityReadout = requiredElement<HTMLElement>("city-readout");
  private readonly energyReadout = requiredElement<HTMLElement>("energy-readout");
  private readonly coldReadout = requiredElement<HTMLElement>("cold-readout");
  private readonly weatherReadout = requiredElement<HTMLElement>("weather-readout");
  private readonly monsterReadout = requiredElement<HTMLElement>("monster-readout");
  private readonly heatReadout = requiredElement<HTMLElement>("heat-readout");
  private readonly frostReadout = requiredElement<HTMLElement>("frost-readout");
  private readonly speedReadout = requiredElement<HTMLElement>("speed-readout");
  private readonly messagePanel = requiredElement<HTMLElement>("message-panel");
  private readonly messageTitle = requiredElement<HTMLElement>("message-title");
  private readonly messageCopy = requiredElement<HTMLElement>("message-copy");
  private readonly primaryAction = requiredElement<HTMLButtonElement>("primary-action");
  private readonly playerNameInput = requiredElement<HTMLInputElement>("player-name");
  private readonly hostLobbyAction = requiredElement<HTMLButtonElement>("host-lobby-action");
  private readonly joinLobbyAction = requiredElement<HTMLButtonElement>("join-lobby-action");
  private readonly copyInviteAction = requiredElement<HTMLButtonElement>("copy-invite-action");
  private readonly lobbyStatus = requiredElement<HTMLElement>("lobby-status");
  private readonly lobbyInvite = requiredElement<HTMLElement>("lobby-invite");
  private readonly lobbyRoster = requiredElement<HTMLElement>("lobby-roster");

  private lastPhase: HudSnapshot["phase"] | undefined;

  constructor(actions: {
    onPrimaryAction: () => void;
    onHostLobby: () => void;
    onJoinLobby: () => void;
    onCopyInvite: () => void;
  }) {
    const savedName = window.localStorage.getItem("skyWardenPlayerName");
    if (savedName) {
      this.playerNameInput.value = savedName;
    }

    this.playerNameInput.addEventListener("change", () => {
      window.localStorage.setItem("skyWardenPlayerName", this.getPlayerName());
    });
    this.primaryAction.addEventListener("click", actions.onPrimaryAction);
    this.hostLobbyAction.addEventListener("click", actions.onHostLobby);
    this.joinLobbyAction.addEventListener("click", actions.onJoinLobby);
    this.copyInviteAction.addEventListener("click", actions.onCopyInvite);
  }

  getPlayerName(): string {
    return this.playerNameInput.value.trim() || "Pilot";
  }

  update(snapshot: HudSnapshot): void {
    const cityPercent = Math.round(snapshot.cityDamage * 100);
    const limitPercent = Math.round(snapshot.cityLimit * 100);
    const energyPercent = Math.round(snapshot.energy * 100);
    const coldPercent = Math.round(snapshot.coldLevel * 100);

    this.cityBar.style.transform = `scaleX(${snapshot.cityDamage.toFixed(3)})`;
    this.cityBar.style.backgroundColor = snapshot.cityDamage > snapshot.cityLimit * 0.72 ? "#d9634f" : "#b84636";
    this.energyBar.style.transform = `scaleX(${snapshot.energy.toFixed(3)})`;
    this.coldBar.style.transform = `scaleX(${snapshot.coldLevel.toFixed(3)})`;

    this.cityReadout.textContent = `${cityPercent}%`;
    this.cityReadout.setAttribute("aria-label", `${cityPercent}% city destruction, limit ${limitPercent}%`);
    this.energyReadout.textContent = `${energyPercent}%`;
    this.coldReadout.textContent = `${coldPercent}%`;
    this.weatherReadout.textContent = snapshot.weather.label;
    this.weatherReadout.setAttribute("aria-label", `${snapshot.weather.label} weather, ${coldPercent}% ambient cold`);
    this.monsterReadout.textContent = String(snapshot.monstersRemaining);
    this.heatReadout.textContent = snapshot.heatStatus;
    this.frostReadout.textContent = snapshot.frostStatus;
    this.speedReadout.textContent = snapshot.speedStatus;

    this.hud.classList.toggle("is-heating", snapshot.heatActive);
    this.hud.classList.toggle("is-freezing", snapshot.frostActive);
    this.hud.classList.toggle("is-weather-rain", snapshot.weather.kind === "rain");
    this.hud.classList.toggle("is-weather-snowy", snapshot.weather.kind === "snowy");
    this.hud.classList.toggle("is-weather-sunny", snapshot.weather.kind === "sunny");
    this.hud.classList.toggle("is-level-complete", snapshot.phase === "level-complete");

    if (this.lastPhase !== snapshot.phase) {
      this.messagePanel.classList.toggle("hidden", snapshot.phase === "playing" || snapshot.phase === "level-complete");
      this.lastPhase = snapshot.phase;
    }

    this.messageTitle.textContent = snapshot.messageTitle;
    this.messageCopy.textContent = snapshot.messageCopy;
    this.primaryAction.textContent = snapshot.actionLabel;
    this.primaryAction.disabled = !snapshot.multiplayer.canStart;

    this.hostLobbyAction.disabled = !snapshot.multiplayer.canHost;
    this.joinLobbyAction.disabled = !snapshot.multiplayer.canJoin;
    this.copyInviteAction.hidden = !snapshot.multiplayer.canCopyInvite;
    this.copyInviteAction.disabled = !snapshot.multiplayer.inviteUrl;
    this.lobbyStatus.textContent = snapshot.multiplayer.status;
    this.lobbyInvite.hidden = !snapshot.multiplayer.inviteUrl;
    this.lobbyInvite.textContent = snapshot.multiplayer.inviteUrl ?? "";
    this.lobbyRoster.replaceChildren(
      ...snapshot.multiplayer.players.map((player) => {
        const item = document.createElement("li");
        const role = player.role === "host" ? "host" : "joined";
        item.textContent = `${player.name} ${role}`;
        item.className = player.connected ? "connected" : "disconnected";
        return item;
      }),
    );
  }
}
