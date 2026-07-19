import type { IncomingMessage } from "http";
import { type VoiceWebSocket } from "../util/WebSocket";
import type { Server } from "../Server";
import type { VoicePeer } from "../types";
import Message from "./Message";
import { logger } from "../Logger";
import Close from "./Close";
import { VoiceOpcodes } from "@mutualzz/types";
import { redis } from "../util/Redis";

const AUTH_TIMEOUT_MS = 5_000;
const VOICE_AUTHENTICATE_OP = VoiceOpcodes.VoiceAuthenticate ?? 9;

const parseAuthEnvelope = (
  raw: string,
): { id: string; token: string } | null => {
  try {
    const envelope = JSON.parse(raw) as {
      id?: unknown;
      op?: unknown;
      data?: { token?: unknown };
    };
    if (envelope.op !== VOICE_AUTHENTICATE_OP) return null;
    const token = envelope.data?.token;
    if (typeof token !== "string" || !token) return null;
    return { id: String(envelope.id ?? ""), token };
  } catch {
    return null;
  }
};

const takeAuthEnvelope = (
  pendingFrames: string[],
): { id: string; token: string } | null => {
  for (let i = 0; i < pendingFrames.length; i++) {
    const parsed = parseAuthEnvelope(pendingFrames[i]!);
    if (!parsed) continue;
    pendingFrames.splice(i, 1);
    return parsed;
  }
  return null;
};

const waitForAuthToken = (
  pendingFrames: string[],
  notify: { current: (() => void) | null },
  timeoutMs: number,
): Promise<{ id: string; token: string } | null> =>
  new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (value: { id: string; token: string } | null) => {
      if (settled) return;
      settled = true;
      notify.current = null;
      if (timer) clearTimeout(timer);
      resolve(value);
    };

    const tryTake = () => {
      const found = takeAuthEnvelope(pendingFrames);
      if (found) finish(found);
    };

    notify.current = tryTake;
    tryTake();
    if (settled) return;

    timer = setTimeout(() => finish(null), timeoutMs);
  });

const ackAuthEnvelope = (
  socket: VoiceWebSocket,
  auth: { id: string; token: string } | null,
  rtpCapabilities?: unknown,
) => {
  if (!auth?.id) return;
  try {
    socket.send(
      JSON.stringify({
        id: auth.id,
        ok: true,
        data: rtpCapabilities ? { rtpCapabilities } : {},
      }),
    );
  } catch {}
};

export default async function Connection(
  this: Server,
  socket: VoiceWebSocket,
  request: IncomingMessage,
) {
  const pendingFrames: string[] = [];
  let ready = false;
  let room: Awaited<ReturnType<Server["getOrCreateRoom"]>> | null = null;
  let peer: VoicePeer | null = null;
  const authNotify: { current: (() => void) | null } = { current: null };

  socket.on("message", (raw) => {
    const rawText =
      typeof raw === "string"
        ? raw
        : Buffer.isBuffer(raw)
          ? raw.toString("utf8")
          : ArrayBuffer.isView(raw)
            ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString(
                "utf8",
              )
            : raw instanceof ArrayBuffer
              ? Buffer.from(raw).toString("utf8")
              : raw.toString();

    if (!ready) {
      pendingFrames.push(rawText);
      authNotify.current?.();
      return;
    }

    if (!room || !peer) return;
    void Message(this, room, peer, rawText);
  });

  socket.on("error", (error) => {
    logger.error(error);
    try {
      socket.close();
    } catch {}
  });

  const requestHost = request.headers.host ?? "localhost";
  const url = new URL(request.url ?? "/", `http://${requestHost}`);
  const queryToken = url.searchParams.get("token");

  let token = queryToken;
  let authRequestId: string | null = null;

  if (!token) {
    const auth = await waitForAuthToken(
      pendingFrames,
      authNotify,
      AUTH_TIMEOUT_MS,
    );
    if (!auth) {
      socket.close(4001, "Missing token");
      return;
    }
    token = auth.token;
    authRequestId = auth.id || null;
  }

  const voiceSession = await this.verifyVoiceToken(socket, token);
  if (!voiceSession) return;

  socket.sessionId = voiceSession.sessionId;

  room = await this.getOrCreateRoom(voiceSession.roomId);
  socket.roomId = room.roomId;

  const rawState = await redis.get(`voice:state:${voiceSession.userId}`);
  let serverMuted = false;
  let serverDeafened = false;
  if (rawState) {
    try {
      const state = JSON.parse(rawState);
      serverMuted = state.spaceMute === true || state.spaceDeaf === true;
      serverDeafened = state.spaceDeaf === true;
    } catch {}
  }

  peer = {
    userId: voiceSession.userId,
    sessionId: voiceSession.sessionId,
    roomId: voiceSession.roomId,
    voiceToken: token,
    serverMuted,
    serverDeafened,
    socket,
    producers: new Map(),
    consumers: new Map(),
  };

  const existingActivePeer = this.activePeersByUserId.get(peer.userId);
  if (existingActivePeer) {
    if (existingActivePeer.socket !== socket)
      this.disconnectPeer(existingActivePeer, 4000, "superseded");
    else if (existingActivePeer.sessionId !== peer.sessionId)
      this.disconnectPeer(existingActivePeer, 4001, "Invalid session");
  }

  const existingRoomPeer = room.peers.get(peer.userId);
  if (existingRoomPeer && existingRoomPeer.socket !== socket)
    this.disconnectPeer(existingRoomPeer, 4000, "Replaced in same room");

  room.peers.set(peer.userId, peer);
  this.activePeersByUserId.set(peer.userId, peer);

  socket.currentPeerId = peer.userId;

  if (authRequestId) {
    ackAuthEnvelope(socket, { id: authRequestId, token }, room.router.rtpCapabilities);
  } else {
    ackAuthEnvelope(
      socket,
      takeAuthEnvelope(pendingFrames),
      room.router.rtpCapabilities,
    );
  }

  (socket as any).isAlive = true;
  socket.on("pong", () => {
    (socket as any).isAlive = true;
  });

  const heartbeat = setInterval(() => {
    if (!(socket as any).isAlive) {
      clearInterval(heartbeat);
      try {
        socket.terminate();
      } catch {}
      return;
    }
    (socket as any).isAlive = false;
    try {
      socket.ping();
    } catch {}
  }, 25_000);

  const boundRoom = room;
  const boundPeer = peer;

  socket.on("close", () => {
    clearInterval(heartbeat);
    Close(this, boundRoom, boundPeer);
  });

  ready = true;
  for (const frame of pendingFrames) {
    void Message(this, boundRoom, boundPeer, frame);
  }
  pendingFrames.length = 0;

  this.broadcastPeerJoined(boundRoom, boundPeer.userId);
}
