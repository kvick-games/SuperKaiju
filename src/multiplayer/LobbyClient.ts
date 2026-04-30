import {
  MULTIPLAYER_PROTOCOL_VERSION,
  sanitizePlayerName,
  type ClientToRelayMessage,
  type GameSnapshot,
  type LobbyCreatedResponse,
  type LobbyId,
  type LobbyPlayer,
  type LobbyRole,
  type PlayerId,
  type PlayerInputState,
  type RelayToClientMessage,
} from "./protocol";

export interface LobbyClientHandlers {
  onJoined?: (details: { lobbyId: LobbyId; playerId: PlayerId; role: LobbyRole; players: LobbyPlayer[] }) => void;
  onRoster?: (players: LobbyPlayer[], started: boolean) => void;
  onStart?: (worldSeed: number, players: LobbyPlayer[]) => void;
  onInput?: (playerId: PlayerId, input: PlayerInputState) => void;
  onSnapshot?: (snapshot: GameSnapshot) => void;
  onClosed?: (reason: string) => void;
  onError?: (reason: string) => void;
  onStatus?: (status: string) => void;
}

export class LobbyClient {
  readonly lobbyId: LobbyId;
  readonly inviteUrl: string | null;
  readonly role: LobbyRole;
  playerId: PlayerId | null = null;
  players: LobbyPlayer[] = [];

  private socket: WebSocket | null = null;
  private joined = false;

  private constructor(
    options: {
      lobbyId: LobbyId;
      inviteUrl: string | null;
      role: LobbyRole;
      hostToken?: string;
      playerName: string;
    },
    private readonly handlers: LobbyClientHandlers,
  ) {
    this.lobbyId = options.lobbyId;
    this.inviteUrl = options.inviteUrl;
    this.role = options.role;
    this.connect(options.playerName, options.hostToken);
  }

  static async host(playerName: string, handlers: LobbyClientHandlers): Promise<LobbyClient> {
    handlers.onStatus?.("Creating lobby");
    const response = await fetch("/api/lobbies", { method: "POST" });
    if (!response.ok) {
      throw new Error(await getErrorMessage(response, "Could not create a Cloudflare lobby."));
    }

    const created = (await response.json()) as LobbyCreatedResponse;
    return new Promise((resolve, reject) => {
      const client = new LobbyClient(
        {
          lobbyId: created.lobbyId,
          inviteUrl: created.inviteUrl,
          role: "host",
          hostToken: created.hostToken,
          playerName,
        },
        {
          ...handlers,
          onJoined(details) {
            handlers.onJoined?.(details);
            resolve(client);
          },
          onError(reason) {
            handlers.onError?.(reason);
            reject(new Error(reason));
          },
        },
      );
    });
  }

  static async join(lobbyId: LobbyId, playerName: string, handlers: LobbyClientHandlers): Promise<LobbyClient> {
    return new Promise((resolve, reject) => {
      const client = new LobbyClient(
        {
          lobbyId,
          inviteUrl: null,
          role: "client",
          playerName,
        },
        {
          ...handlers,
          onJoined(details) {
            handlers.onJoined?.(details);
            resolve(client);
          },
          onError(reason) {
            handlers.onError?.(reason);
            reject(new Error(reason));
          },
        },
      );
    });
  }

  sendStart(worldSeed: number): void {
    this.send({ type: "host:start", worldSeed });
  }

  sendInput(input: PlayerInputState): void {
    this.send({ type: "client:input", input });
  }

  sendSnapshot(snapshot: GameSnapshot): void {
    this.send({ type: "host:snapshot", snapshot });
  }

  disconnect(): void {
    this.socket?.close(1000, "Leaving lobby");
    this.socket = null;
  }

  private connect(playerName: string, hostToken?: string): void {
    this.handlers.onStatus?.("Connecting to lobby");
    const url = createWebSocketUrl(this.lobbyId);
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.send({
        type: "client:join",
        protocol: MULTIPLAYER_PROTOCOL_VERSION,
        role: this.role,
        playerName: sanitizePlayerName(playerName),
        hostToken,
      });
    });

    socket.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });

    socket.addEventListener("close", () => {
      if (this.joined) {
        this.handlers.onClosed?.("Disconnected from lobby.");
      }
    });

    socket.addEventListener("error", () => {
      this.handlers.onError?.("Lobby connection failed. Use the Cloudflare dev/deploy server, not the plain Vite server.");
    });
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") {
      return;
    }

    let message: RelayToClientMessage;
    try {
      message = JSON.parse(data) as RelayToClientMessage;
    } catch {
      this.handlers.onError?.("Received a malformed lobby message.");
      return;
    }

    if (message.type === "relay:hello") {
      this.handlers.onStatus?.("Joining lobby");
      return;
    }

    if (message.type === "relay:joined") {
      this.joined = true;
      this.playerId = message.playerId;
      this.players = message.players;
      this.handlers.onStatus?.(this.role === "host" ? "Lobby ready" : "Connected to lobby");
      this.handlers.onJoined?.({
        lobbyId: message.lobbyId,
        playerId: message.playerId,
        role: message.role,
        players: message.players,
      });
      this.handlers.onRoster?.(message.players, message.started);
      return;
    }

    if (message.type === "relay:roster") {
      this.players = message.players;
      this.handlers.onRoster?.(message.players, message.started);
      return;
    }

    if (message.type === "relay:start") {
      this.players = message.players;
      this.handlers.onStart?.(message.worldSeed, message.players);
      return;
    }

    if (message.type === "relay:input") {
      this.handlers.onInput?.(message.playerId, message.input);
      return;
    }

    if (message.type === "relay:snapshot") {
      this.handlers.onSnapshot?.(message.snapshot);
      return;
    }

    if (message.type === "relay:closed") {
      this.handlers.onClosed?.(message.reason);
      return;
    }

    if (message.type === "relay:error") {
      this.handlers.onError?.(message.reason);
    }
  }

  private send(message: ClientToRelayMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(message));
  }
}

export function getLobbyIdFromLocation(location: Location = window.location): LobbyId | null {
  const lobby = new URLSearchParams(location.search).get("lobby");
  return lobby ? lobby.toLowerCase() : null;
}

function createWebSocketUrl(lobbyId: LobbyId): string {
  const url = new URL(`/ws/lobbies/${encodeURIComponent(lobbyId)}`, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}
