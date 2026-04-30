import { Game } from "./Game.js";
import "./gameStyles.css";
import {
  createOpenStreetMapLayoutRequest,
  fetchOpenStreetMapLayoutWithTimeout,
} from "./OpenStreetMapLayout.js";

export async function mountGame(root: HTMLElement): Promise<() => void> {
  root.innerHTML = `
    <main id="game-shell" aria-label="Sky Warden Kaiju Break game">
      <div id="scene-root"></div>
      <section id="hud" aria-live="polite">
        <div class="hud-top">
          <div class="brand-lockup">
            <p class="eyebrow">Sky Warden</p>
            <h1>Kaiju Break</h1>
          </div>
          <div class="status-strip" aria-label="Game status">
            <div class="meter city-meter">
              <span>City</span>
              <div class="meter-track"><i id="city-bar"></i></div>
              <strong id="city-readout">0%</strong>
            </div>
            <div class="meter power-meter">
              <span>Energy</span>
              <div class="meter-track"><i id="energy-bar"></i></div>
              <strong id="energy-readout">100%</strong>
            </div>
            <div class="meter cold-meter">
              <span id="weather-readout">Sunny</span>
              <div class="meter-track"><i id="cold-bar"></i></div>
              <strong id="cold-readout">0%</strong>
            </div>
            <div class="metric">
              <span>Monsters</span>
              <strong id="monster-readout">0</strong>
            </div>
          </div>
        </div>

        <div class="reticle" aria-hidden="true">
          <i></i><b></b>
        </div>

        <div class="power-rack" aria-label="Power status">
          <div class="power-chip heat">
            <span>Heat vision</span>
            <strong id="heat-readout">Ready</strong>
          </div>
          <div class="power-chip frost">
            <span>Frost breath</span>
            <strong id="frost-readout">Ready</strong>
          </div>
          <div class="power-chip speed">
            <span>Boost</span>
            <strong id="speed-readout">Shift</strong>
          </div>
        </div>

        <div class="controls-panel">
          <span>WASD steer</span>
          <span>Mouse aim</span>
          <span>Click canvas to lock</span>
          <span>Space climb</span>
          <span>Ctrl descend</span>
          <span>LMB heat</span>
          <span>RMB frost</span>
          <span id="map-source">Procedural city</span>
        </div>

        <div id="message-panel" class="message-panel">
          <p class="eyebrow">Original arcade prototype</p>
          <h2 id="message-title">Defend Caldera City</h2>
          <p id="message-copy">
            Fly through the downtown canyons, break the rampaging monsters, and keep destruction below 60%.
          </p>
          <div class="lobby-panel" aria-label="Co-op lobby">
            <label class="player-name-field">
              <span>Pilot name</span>
              <input id="player-name" type="text" maxlength="18" autocomplete="nickname" value="Pilot" />
            </label>
            <div class="lobby-actions">
              <button id="primary-action" type="button">Start sortie</button>
              <button id="host-lobby-action" type="button">Host co-op</button>
              <button id="join-lobby-action" type="button">Join co-op</button>
              <button id="copy-invite-action" type="button" hidden>Copy invite</button>
            </div>
            <p id="lobby-status" class="lobby-status">Solo sortie ready</p>
            <p id="lobby-invite" class="lobby-invite" hidden></p>
            <ul id="lobby-roster" class="lobby-roster" aria-label="Lobby players"></ul>
          </div>
        </div>
      </section>
    </main>
  `;

  const sceneRoot = document.getElementById("scene-root");
  if (!sceneRoot) {
    throw new Error("Missing #scene-root");
  }

  const mapSource = document.getElementById("map-source");
  const layoutRequest = createOpenStreetMapLayoutRequest(new URLSearchParams(window.location.search));
  const cityLayout = layoutRequest ? await loadOpenStreetMapLayout(layoutRequest) : null;
  if (mapSource) {
    mapSource.textContent = cityLayout?.sourceName ? `Map: ${cityLayout.sourceName}` : "Procedural city";
  }

  const game = new Game(sceneRoot, { cityLayout });
  return () => game.dispose();
}

async function loadOpenStreetMapLayout(
  request: NonNullable<ReturnType<typeof createOpenStreetMapLayoutRequest>>,
) {
  try {
    const layout = await fetchOpenStreetMapLayoutWithTimeout(request);
    if (!layout) {
      console.warn("OpenStreetMap data did not produce a playable layout; using procedural city.");
    }
    return layout;
  } catch (error) {
    console.warn("OpenStreetMap load failed; using procedural city.", error);
    return null;
  }
}
