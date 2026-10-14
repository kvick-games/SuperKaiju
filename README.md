# Sky Warden: Kaiju Break

Browser arcade flight game built with Vite, TypeScript, and Three.js. You fly over Caldera City, break the rampaging kaiju, and keep city destruction under 60%.

The title panel opens on **Defend Caldera City**. **Start sortie** (or Enter) begins the run. Clearing every monster plays a short level-complete beat, then the win panel (**City secure**). If city damage hits the 60% limit first, the run ends as a loss (**City breach**). The HUD tracks city damage, shared energy, weather and ambient cold, monsters remaining, and heat / frost / boost status.

Three kaiju spawn each run and smash buildings:

| Kaiju | Ability | Melee order |
| --- | --- | --- |
| Bracken Maw | Tail spikes | Stomp, swipe, bite |
| Stormfang | Fire breath | Swipe, bite, stomp |
| Ironback | Shockwave | Stomp, swipe, stomp, bite |

Weather cycles through sunny, rain, and snowy. The default city is a procedural grid. `?osm` loads Downtown Seattle from OpenStreetMap (Overpass). `?osm=manhattan` and `?osm=sf` are the other built-in boxes. `?osmBbox=south,west,north,east` uses a custom box, and optional `osmSize` is clamped between 180 and 620. A failed or empty map falls back to the procedural city.

`?editor` opens the control-rig editor instead of the game. `?coop=disabled` turns co-op off. With co-op on, **Host co-op** creates a lobby (up to 4 pilots) and **Join co-op** accepts an invite link. A `?lobby=` URL joins that lobby. The host starts the shared sortie; clients wait.

Hosting notes for the Dreamatron site sync live in [docs/dreamatron-sync.md](docs/dreamatron-sync.md).

## Controls

Inputs come from `src/game/Input.ts`, `Player.ts`, and `Powers.ts`. The on-screen strip matches this list.

| Input | Action |
| --- | --- |
| W A S D | Steer. W moves along your facing, S reverses, A and D strafe. |
| Mouse | Aim. Yaw and pitch follow mouse movement. |
| Left click | Request pointer lock on the canvas. Also fires heat vision while held. |
| Right click | Frost breath while held. The canvas context menu is suppressed. |
| Space | Climb. |
| Ctrl | Descend. Either Control key. |
| Shift | Boost. Either Shift key. Needs enough energy to start. W/A/S/D thrust spends energy; emptying it locks boost until Shift is released. With no W/A/S/D input, boost glides under gravity and recharges a little. Space and Ctrl do not climb or descend while boost is active. A fast boost can ram kaiju and buildings. |
| Enter | Same as the primary button: start, fly again, or retry. Ignored while playing, during the level-complete beat, and for co-op clients. |
| R | Restart the sortie on a new seed. Ignored for co-op clients. |

Heat vision, frost breath, and boost share one energy pool. Each needs a minimum charge to start, drains while active, and shows Ready, Charging, or Drained when it cannot fire. Heat vision damages and warms the first kaiju or building along the beam, and can ignite a surface it hits. Frost breath spends energy and leaves freezing clouds.

## Architecture

`index.html` loads `src/main.ts`. That file mounts the game, or the rig editor when the `editor` query flag is set.

### `src/`

- `src/game/` is the sortie. `Game.ts` owns the frame loop, phases, chase camera, and host/client updates. On a win inside a parent frame it posts a `dreamatron:score` message. `mountGame.ts` builds the HUD shell and the optional map load. `Player.ts` flies; `Input.ts` reads keys and the mouse; `CapeCloth.ts` and `SpeedLines.ts` are the cape and boost streaks. `Powers.ts` runs heat vision and frost breath, with `Fire.ts`, `FireSimulation.ts`, and `Cold.ts`. `Enemies.ts`, `KaijuClasses.ts`, and `KaijuRig.ts` are the three kaiju. `City.ts` and `CityLayout.ts` build and damage the city; `OpenStreetMapLayout.ts` is the optional map. `Weather.ts`, `Scene.ts`, `SoundSystem.ts`, and `Hud.ts` are weather, the Three.js view, audio, and the DOM readout.
- `src/multiplayer/` is the shared lobby protocol (`protocol.ts`, version 1, max 4 players), `LobbyClient.ts` (create/join over HTTP and WebSocket), and `RemoteInputController.ts` for other pilots' inputs.
- `src/core/` is the framework-agnostic rig runtime: definitions, a constraint graph, and solvers for `fkChain`, `twoBoneIK`, `aim`, `parent`, `orient`, and `position`.
- `src/three/` binds that rig to Three.js (skeleton, ragdoll, demo character, viewport).
- `src/editor/` is the embeddable rig editor. `src/index.ts` re-exports core, Three, and editor. `tsconfig.build.json` emits those packages plus `src/multiplayer` to `dist/lib`.

### `worker/`

`worker/index.ts` is the Cloudflare Worker (`wrangler.toml`, name `sky-warden-kaiju-break`). It serves the Vite build from `dist/demo`, accepts `POST /api/lobbies`, and upgrades `/ws/lobbies/:id` onto a `LobbyRoom` Durable Object. That room relays join, start, input, and snapshot messages. `/api/*` and `/ws/*` hit the worker before static assets.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on `127.0.0.1`. |
| `npm run dev:cloudflare` | `build:demo`, then `wrangler dev`. |
| `npm run dev:public` | `scripts/dev-public.mjs`: demo build, then Wrangler with a tunnel. |
| `npm run typecheck` | `tsc --noEmit` for the app, and `tsc -p tsconfig.worker.json --noEmit` for the worker. |
| `npm run build` | Typecheck, then `build:lib` and `build:demo`. |
| `npm run build:lib` | `tsc -p tsconfig.build.json` into `dist/lib`. |
| `npm run build:demo` | `vite build` into `dist/demo` (`base: "./"`). |
| `npm run preview` | Vite preview on `127.0.0.1`. |
| `npm test` | `build:lib`, then `node tests/run-tests.mjs`. |
| `npm run deploy:cloudflare` | Full build, then `wrangler deploy`. |

`npm test` asserts the rig constraint order, demo character and ragdoll exports, the editor factory, and multiplayer protocol helpers (`MULTIPLAYER_PROTOCOL_VERSION`, `MAX_LOBBY_PLAYERS`, `sanitizePlayerName`, `isProtocolMessage`) against `dist/lib`.
