/// <reference types="@cloudflare/workers-types" />

import {
  MAX_LOBBY_PLAYERS,
  MULTIPLAYER_PROTOCOL_VERSION,
  isProtocolMessage,
  sanitizePlayerName,
  type ClientToRelayMessage,
  type LobbyCreatedResponse,
  type LobbyId,
  type LobbyPlayer,
  type LobbyRole,
  type PlayerId,
  type RelayToClientMessage,
} from "../src/multiplayer/protocol";

interface Env {
  ASSETS: Fetcher;
  LOBBIES: DurableObjectNamespace;
  PUBLIC_INVITE_ORIGIN?: string;
  ALLOWED_ORIGINS?: string;
}

interface LobbyCreateRequest {
  hostToken: string;
}

interface SocketAttachment {
  joined: boolean;
  playerId: PlayerId;
  playerName: string;
  role: LobbyRole;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};
const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://dreamatron.ai",
  "https://www.dreamatron.ai",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
]);
const PUBLIC_ORIGIN_OBJECT_NAME = "__public_invite_origin__";
const PUBLIC_ORIGIN_ENDPOINT = "https://internal.invalid/_internal/public-origin";

let latestPublicOrigin: string | null = null;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    await rememberPublicOrigin(request, env);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: getCorsPreflightHeaders(request, env) });
    }

    if (request.method === "POST" && url.pathname === "/api/lobbies") {
      return createLobby(request, env);
    }

    const lobbyMatch = url.pathname.match(/^\/ws\/lobbies\/([a-z0-9-]+)$/i);
    if (lobbyMatch) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return json({ error: "Expected WebSocket upgrade." }, 426);
      }

      const lobbyId = lobbyMatch[1].toLowerCase();
      const durableId = env.LOBBIES.idFromName(lobbyId);
      return env.LOBBIES.get(durableId).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

async function createLobby(request: Request, env: Env): Promise<Response> {
  const corsHeaders = getCorsHeaders(request, env);
  const lobbyId = createShortId();
  const hostToken = createToken();
  const durableId = env.LOBBIES.idFromName(lobbyId);
  const createUrl = new URL(`/create/${lobbyId}`, request.url);
  const createResponse = await env.LOBBIES.get(durableId).fetch(
    new Request(createUrl, {
      method: "POST",
      body: JSON.stringify({ hostToken } satisfies LobbyCreateRequest),
      headers: JSON_HEADERS,
    }),
  );

  if (!createResponse.ok) {
    return new Response(createResponse.body, {
      status: createResponse.status,
      headers: {
        ...JSON_HEADERS,
        ...corsHeaders,
      },
    });
  }

  const inviteOrigin = await getInviteOrigin(request, env);
  const inviteUrl = new URL(inviteOrigin ?? request.url);
  inviteUrl.pathname = "/";
  inviteUrl.search = `?lobby=${encodeURIComponent(lobbyId)}`;
  inviteUrl.hash = "";

  return json({
    lobbyId,
    hostToken,
    inviteUrl: inviteUrl.toString(),
  } satisfies LobbyCreatedResponse, 200, corsHeaders);
}

export class LobbyRoom {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const lobbyId = getLobbyId(url);

    if (url.pathname === "/_internal/public-origin") {
      return this.handlePublicOrigin(request);
    }

    if (request.method === "POST" && url.pathname.startsWith("/create/")) {
      const body = (await request.json()) as Partial<LobbyCreateRequest>;
      if (!body.hostToken) {
        return json({ error: "Missing host token." }, 400);
      }

      await this.state.storage.put("lobbyId", lobbyId);
      await this.state.storage.put("hostToken", body.hostToken);
      await this.state.storage.put("started", false);
      await this.state.storage.put("closed", false);
      return json({ ok: true });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ error: "Expected WebSocket upgrade." }, 426);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({
      joined: false,
      playerId: "",
      playerName: "",
      role: "client",
    } satisfies SocketAttachment);
    this.state.acceptWebSocket(server);
    server.send(
      encode({
        type: "relay:hello",
        lobbyId,
      }),
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message !== "string") {
      this.send(ws, { type: "relay:error", reason: "Binary messages are not supported." });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      this.send(ws, { type: "relay:error", reason: "Malformed JSON message." });
      return;
    }

    if (!isProtocolMessage(parsed)) {
      this.send(ws, { type: "relay:error", reason: "Missing message type." });
      return;
    }

    const clientMessage = parsed as ClientToRelayMessage;
    if (clientMessage.type === "client:join") {
      await this.handleJoin(ws, clientMessage);
      return;
    }

    if (clientMessage.type === "ping") {
      this.send(ws, { type: "pong", sentAt: clientMessage.sentAt, receivedAt: Date.now() });
      return;
    }

    const attachment = getAttachment(ws);
    if (!attachment?.joined) {
      this.send(ws, { type: "relay:error", reason: "Join the lobby before sending messages." });
      return;
    }

    if (clientMessage.type === "client:input") {
      this.forwardToHost({
        type: "relay:input",
        playerId: attachment.playerId,
        input: clientMessage.input,
      });
      return;
    }

    if (clientMessage.type === "host:start") {
      if (attachment.role !== "host") {
        this.send(ws, { type: "relay:error", reason: "Only the host can start the lobby." });
        return;
      }

      await this.state.storage.put("started", true);
      await this.state.storage.put("worldSeed", clientMessage.worldSeed);
      this.broadcast({
        type: "relay:start",
        worldSeed: clientMessage.worldSeed,
        players: this.getPlayers(),
      });
      return;
    }

    if (clientMessage.type === "host:snapshot") {
      if (attachment.role !== "host") {
        this.send(ws, { type: "relay:error", reason: "Only the host can publish snapshots." });
        return;
      }

      this.broadcast(
        {
          type: "relay:snapshot",
          snapshot: clientMessage.snapshot,
        },
        (candidate) => getAttachment(candidate)?.role !== "host",
      );
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    await this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }

  private async handleJoin(
    ws: WebSocket,
    message: Extract<ClientToRelayMessage, { type: "client:join" }>,
  ): Promise<void> {
    if (message.protocol !== MULTIPLAYER_PROTOCOL_VERSION) {
      this.send(ws, { type: "relay:error", reason: "This game build is not compatible with the lobby." });
      ws.close(1003, "Protocol mismatch");
      return;
    }

    const closed = await this.state.storage.get<boolean>("closed");
    if (closed) {
      this.send(ws, { type: "relay:error", reason: "This lobby has closed." });
      ws.close(1008, "Lobby closed");
      return;
    }

    const started = (await this.state.storage.get<boolean>("started")) ?? false;
    const hostToken = await this.state.storage.get<string>("hostToken");
    const players = this.getPlayers();
    const lobbyId = (await this.state.storage.get<LobbyId>("lobbyId")) ?? "lobby";
    const playerName = sanitizePlayerName(message.playerName);

    if (message.role === "host") {
      if (!hostToken || message.hostToken !== hostToken) {
        this.send(ws, { type: "relay:error", reason: "Invalid host token." });
        ws.close(1008, "Invalid host token");
        return;
      }

      if (players.some((player) => player.role === "host")) {
        this.send(ws, { type: "relay:error", reason: "The host is already connected." });
        ws.close(1008, "Host already connected");
        return;
      }

      this.attachPlayer(ws, { playerId: "host", playerName, role: "host", joined: true });
      const roster = this.getPlayers();
      this.send(ws, {
        type: "relay:joined",
        lobbyId,
        playerId: "host",
        role: "host",
        players: roster,
        started,
      });
      this.broadcast({ type: "relay:roster", players: roster, started });
      return;
    }

    if (!players.some((player) => player.role === "host")) {
      this.send(ws, { type: "relay:error", reason: "The host is not connected yet." });
      ws.close(1008, "Host missing");
      return;
    }

    if (started) {
      this.send(ws, { type: "relay:error", reason: "This lobby already started." });
      ws.close(1008, "Lobby already started");
      return;
    }

    if (players.length >= MAX_LOBBY_PLAYERS) {
      this.send(ws, { type: "relay:error", reason: "This lobby is full." });
      ws.close(1008, "Lobby full");
      return;
    }

    const playerId = createPlayerId(players);
    this.attachPlayer(ws, { playerId, playerName, role: "client", joined: true });
    const roster = this.getPlayers();
    this.send(ws, {
      type: "relay:joined",
      lobbyId,
      playerId,
      role: "client",
      players: roster,
      started,
    });
    this.broadcast({ type: "relay:roster", players: roster, started });
  }

  private async handleDisconnect(ws: WebSocket): Promise<void> {
    const attachment = getAttachment(ws);
    if (!attachment?.joined) {
      return;
    }

    if (attachment.role === "host") {
      await this.state.storage.put("closed", true);
      this.broadcast(
        { type: "relay:closed", reason: "The host left the lobby." },
        (candidate) => candidate !== ws,
      );
      for (const socket of this.state.getWebSockets()) {
        if (socket !== ws) {
          socket.close(1001, "Host left");
        }
      }
      return;
    }

    ws.serializeAttachment({
      ...attachment,
      joined: false,
    } satisfies SocketAttachment);
    this.broadcast({
      type: "relay:roster",
      players: this.getPlayers(),
      started: (await this.state.storage.get<boolean>("started")) ?? false,
    });
  }

  private attachPlayer(ws: WebSocket, attachment: SocketAttachment): void {
    ws.serializeAttachment(attachment);
  }

  private getPlayers(): LobbyPlayer[] {
    return this.state
      .getWebSockets()
      .map((socket) => getAttachment(socket))
      .filter((attachment): attachment is SocketAttachment => Boolean(attachment?.joined))
      .map((attachment) => ({
        id: attachment.playerId,
        name: attachment.playerName,
        role: attachment.role,
        connected: true,
      }));
  }

  private forwardToHost(message: RelayToClientMessage): void {
    for (const socket of this.state.getWebSockets()) {
      if (getAttachment(socket)?.role === "host") {
        this.send(socket, message);
      }
    }
  }

  private broadcast(message: RelayToClientMessage, predicate: (ws: WebSocket) => boolean = () => true): void {
    for (const socket of this.state.getWebSockets()) {
      if (predicate(socket)) {
        this.send(socket, message);
      }
    }
  }

  private send(ws: WebSocket, message: RelayToClientMessage): void {
    try {
      ws.send(encode(message));
    } catch {
      ws.close(1011, "Failed to send message");
    }
  }

  private async handlePublicOrigin(request: Request): Promise<Response> {
    if (request.method === "PUT") {
      const body = (await request.json()) as Partial<{ origin: string }>;
      const origin = normalizePublicOrigin(body.origin);
      if (!origin) {
        return json({ error: "Expected a public origin." }, 400);
      }

      await this.state.storage.put("publicOrigin", origin);
      return json({ origin });
    }

    if (request.method === "GET") {
      return json({
        origin: (await this.state.storage.get<string>("publicOrigin")) ?? null,
      });
    }

    return json({ error: "Method not allowed." }, 405);
  }

}

function getLobbyId(url: URL): LobbyId {
  const match = url.pathname.match(/\/(?:create\/|ws\/lobbies\/)([a-z0-9-]+)/i);
  return match?.[1]?.toLowerCase() ?? "lobby";
}

async function rememberPublicOrigin(request: Request, env: Env): Promise<void> {
  const origin = getRequestPublicOrigin(request);
  if (!origin) {
    return;
  }

  latestPublicOrigin = origin;
  const response = await getPublicOriginStore(env).fetch(
    new Request(PUBLIC_ORIGIN_ENDPOINT, {
      method: "PUT",
      body: JSON.stringify({ origin }),
      headers: JSON_HEADERS,
    }),
  );

  if (!response.ok) {
    latestPublicOrigin = null;
  }
}

async function getInviteOrigin(request: Request, env: Env): Promise<string | null> {
  const configuredOrigin = normalizePublicOrigin(env.PUBLIC_INVITE_ORIGIN);
  if (configuredOrigin) {
    return configuredOrigin;
  }

  const requestOrigin = getRequestPublicOrigin(request);
  if (requestOrigin) {
    return requestOrigin;
  }

  if (latestPublicOrigin) {
    return latestPublicOrigin;
  }

  const response = await getPublicOriginStore(env).fetch(new Request(PUBLIC_ORIGIN_ENDPOINT));
  if (response.ok) {
    const body = (await response.json()) as Partial<{ origin: string | null }>;
    const storedOrigin = normalizePublicOrigin(body.origin);
    if (storedOrigin) {
      latestPublicOrigin = storedOrigin;
      return storedOrigin;
    }
  }

  return latestPublicOrigin;
}

function getPublicOriginStore(env: Env): DurableObjectStub {
  return env.LOBBIES.get(env.LOBBIES.idFromName(PUBLIC_ORIGIN_OBJECT_NAME));
}

function getRequestPublicOrigin(request: Request): string | null {
  const url = new URL(request.url);
  if (isLocalHost(url.hostname)) {
    return null;
  }

  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "http" ? "http:" : "https:";
  return normalizePublicOrigin(`${protocol}//${url.host}`);
}

function normalizePublicOrigin(origin: unknown): string | null {
  if (typeof origin !== "string" || origin.length === 0) {
    return null;
  }

  try {
    const url = new URL(origin);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || isLocalHost(url.hostname)) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function isLocalHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost")
  );
}

function getAttachment(ws: WebSocket): SocketAttachment | null {
  const attachment = ws.deserializeAttachment() as Partial<SocketAttachment> | undefined;
  if (!attachment?.joined || !attachment.playerId || !attachment.playerName || !attachment.role) {
    return null;
  }

  return {
    joined: true,
    playerId: attachment.playerId,
    playerName: attachment.playerName,
    role: attachment.role,
  };
}

function encode(message: RelayToClientMessage): string {
  return JSON.stringify(message);
}

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...headers,
    },
  });
}

function getCorsPreflightHeaders(request: Request, env: Env): HeadersInit {
  const headers = getCorsHeaders(request, env);
  return {
    ...headers,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function getCorsHeaders(request: Request, env: Env): HeadersInit {
  const origin = normalizeCorsOrigin(request.headers.get("Origin"));
  if (!origin || !isAllowedCorsOrigin(origin, env)) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

function isAllowedCorsOrigin(origin: string, env: Env): boolean {
  if (DEFAULT_ALLOWED_ORIGINS.has(origin)) {
    return true;
  }

  const hostname = new URL(origin).hostname.toLowerCase();
  if (hostname.endsWith(".vercel.app")) {
    return true;
  }

  const configuredOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => normalizeCorsOrigin(value))
    .filter((value): value is string => Boolean(value));

  return configuredOrigins.includes(origin);
}

function normalizeCorsOrigin(origin: unknown): string | null {
  if (typeof origin !== "string" || origin.trim().length === 0) {
    return null;
  }

  try {
    const url = new URL(origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function createShortId(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let id = "";
  for (const byte of bytes) {
    id += alphabet[byte % alphabet.length];
  }
  return id;
}

function createToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createPlayerId(players: LobbyPlayer[]): PlayerId {
  const used = new Set(players.map((player) => player.id));
  for (let index = 2; index <= MAX_LOBBY_PLAYERS; index += 1) {
    const id = `p${index}`;
    if (!used.has(id)) {
      return id;
    }
  }

  return `p${Math.floor(Math.random() * 10000)}`;
}
