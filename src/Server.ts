import { WebSocketServer } from "ws";
import http, { type Server as HttpServer } from "http";
import { createWorker, type types } from "mediasoup";
import type { ServerPushEnvelope, VoicePeer, VoiceRoom } from "./types.ts";
import { verifyVoiceToken } from "./util/Common";
import { logger } from "./Logger.ts";
import type { VoiceWebSocket } from "./util/WebSocket";
import { type Snowflake, VoiceDispatchEvents } from "@mutualzz/types";
import Connection from "./events/Connection";
import config from "./Config.ts";

export class Server {
  readonly rooms = new Map<string, VoiceRoom>(); // roomId -> VoiceRoom
  readonly workers: types.Worker[] = [];
  nextWorkerIndex = 0;
  readonly activePeersByUserId = new Map<Snowflake, VoicePeer>();
  private readonly server: HttpServer;
  private readonly ws: WebSocketServer;
  private workersReady = false;
  private readonly roomCloseTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly roomCreatePromises = new Map<string, Promise<VoiceRoom>>();

  constructor() {
    this.server = http.createServer();
    this.ws = new WebSocketServer({ server: this.server });

    this.ws.on("connection", (socket, request) => {
      return Connection.call(this, socket as VoiceWebSocket, request);
    });
    this.ws.on("error", (err) => {
      logger.error(`WebSocket error: ${err}`);
    });
  }

  async verifyVoiceToken(socket: VoiceWebSocket, token: string | null) {
    if (!token) {
      socket.close(4001, "Missing token");
      return null;
    }

    const voiceSession = await verifyVoiceToken(token);
    if (!voiceSession) {
      logger.warn("verifyVoiceToken failed", {
        tokenFingerprint: token.slice(-8),
        socketIp: (socket as any)._socket.remoteAddress,
      });
      socket.close(4001, "Invalid token");
      return null;
    }

    return voiceSession;
  }

  kickPeerByUserId(
    userId: Snowflake,
    reasonCode = 4000,
    reason = "Kicked from voice",
    roomId?: string | null,
    sessionId?: string | null,
  ) {
    const peer = this.activePeersByUserId.get(userId);
    if (!peer) return false;
    if (roomId != null && peer.roomId !== roomId) return false;
    if (sessionId != null && peer.sessionId !== sessionId) return false;

    const room = this.getRoom(peer.roomId);
    if (!room) return false;

    this.disconnectPeer(peer, reasonCode, reason);
    return true;
  }

  async setPeerModeration(
    userId: Snowflake,
    muted: boolean,
    deafened: boolean,
    roomId?: string | null,
  ) {
    const peer = this.activePeersByUserId.get(userId);
    if (!peer) return false;
    if (roomId != null && peer.roomId !== roomId) return false;

    peer.serverMuted = muted;
    peer.serverDeafened = deafened;

    await Promise.all([
      ...Array.from(peer.producers.values())
        .filter(
          (producer) =>
            producer.kind === "audio" &&
            producer.appData.mediaKind !== "screen-audio",
        )
        .map((producer) => (muted ? producer.pause() : producer.resume())),
      ...Array.from(peer.consumers.values())
        .filter((consumer) => consumer.kind === "audio")
        .map(async (consumer) => {
          if (deafened) {
            if (!consumer.paused) {
              consumer.appData.serverDeafenedPaused = true;
              await consumer.pause();
            }
            return;
          }
          if (consumer.appData.serverDeafenedPaused === true) {
            consumer.appData.serverDeafenedPaused = false;
            await consumer.resume();
          } else if (
            consumer.appData.clientResumeRequested === true &&
            consumer.paused
          ) {
            await consumer.resume();
          }
        }),
    ]);

    return true;
  }

  async stop() {
    this.ws.clients.forEach((x) => x.close());
    this.ws.close();
  }

  async start() {
    if (!this.workersReady) {
      await this.createWorkers();
      this.workersReady = true;
    }

    if (this.server.listening) return;

    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(config.listenPort, config.listenIp, () => resolve());
    });

    logger.info(`Online on ${config.listenIp}:${config.listenPort}`);
  }

  async createWorkers() {
    let numWorkers = config.mediasoup.numWorkers;

    if (numWorkers === 0) {
      logger.warn("Configured 0 mediasoup workers; defaulting to 1.");
      numWorkers += 1;
    }

    for (let workerIndex = 0; workerIndex < numWorkers; workerIndex++) {
      const worker = await createWorker({
        logLevel: config.mediasoup.worker.logLevel,
        logTags: config.mediasoup.worker.logTags,
      });

      worker.on("died", () => {
        logger.error("mediasoup worker died; exiting");
        process.exit(1);
      });

      this.workers.push(worker);
    }

    logger.debug(`Workers created: ${this.workers.length}`);
  }

  getNextWorker(): {
    worker: types.Worker;
    workerIndex: number;
  } {
    if (this.workers.length === 0)
      throw new Error("No mediasoup workers initialized. Call start() first.");

    const workerIndex = this.nextWorkerIndex++ % this.workers.length;
    return { worker: this.workers[workerIndex], workerIndex };
  }

  async getOrCreateRoom(roomId: string) {
    const pendingClose = this.roomCloseTimers.get(roomId);
    if (pendingClose) {
      clearTimeout(pendingClose);
      this.roomCloseTimers.delete(roomId);
    }

    const existing = this.rooms.get(roomId);
    if (existing) return existing;

    const pendingCreate = this.roomCreatePromises.get(roomId);
    if (pendingCreate) return pendingCreate;

    const create = (async () => {
      const { worker, workerIndex } = this.getNextWorker();
      const mediaCodecs = config.router.mediaCodecs;

      const router = await worker.createRouter({
        mediaCodecs,
      });

      const current = this.rooms.get(roomId);
      if (current) {
        try {
          router.close();
        } catch {
          /* empty */
        }
        return current;
      }

      const room: VoiceRoom = {
        roomId,
        router,
        peers: new Map(),
        workerIndex,
      };

      this.rooms.set(roomId, room);
      return room;
    })();

    this.roomCreatePromises.set(roomId, create);
    try {
      return await create;
    } finally {
      this.roomCreatePromises.delete(roomId);
    }
  }

  closeRoom(room: VoiceRoom) {
    const existingTimer = this.roomCloseTimers.get(room.roomId);
    if (existingTimer) return;

    const timer = setTimeout(() => {
      const currentRoom = this.rooms.get(room.roomId);
      if (!currentRoom || currentRoom.peers.size > 0) {
        this.roomCloseTimers.delete(room.roomId);
        return;
      }

      this.rooms.delete(room.roomId);
      this.roomCloseTimers.delete(room.roomId);

      if (currentRoom.peers.size > 0) {
        if (!this.rooms.has(room.roomId)) {
          this.rooms.set(room.roomId, currentRoom);
        }
        return;
      }

      try {
        currentRoom.router.close();
      } catch {
        /* empty */
      }

      logger.debug(`Room ${room.roomId} closed`);
    }, config.roomCloseDelayMs);

    this.roomCloseTimers.set(room.roomId, timer);
  }

  getRoom(roomId: string) {
    return this.rooms.get(roomId);
  }

  disconnectPeer(peer: VoicePeer, reasonCode = 4000, reason = "Replaced") {
    let broadcastLeft = false;
    try {
      peer.socket.close(reasonCode, reason);
    } catch {
      /* empty */
    }

    try {
      const room = this.getRoom(peer.roomId);
      if (room) broadcastLeft = this.cleanupPeer(room, peer);
    } catch {
      /* empty */
    }

    if (broadcastLeft) {
      try {
        const room = this.getRoom(peer.roomId);
        if (room) this.broadcastPeerLeft(room, peer.userId);
      } catch {
        /* empty */
      }
    }
  }

  cleanupPeer(room: VoiceRoom, peer: VoicePeer) {
    for (const consumer of peer.consumers.values()) {
      try {
        consumer.close();
      } catch {
        /* empty */
      }
    }
    peer.consumers.clear();

    for (const producer of peer.producers.values()) {
      try {
        producer.close();
      } catch {
        /* empty */
      }
    }
    peer.producers.clear();

    try {
      peer.sendTransport?.close();
    } catch {
      /* empty */
    }

    try {
      peer.receiverTransport?.close();
    } catch {
      /* empty */
    }

    const wasRoomPeer = room.peers.get(peer.userId) === peer;
    if (wasRoomPeer) room.peers.delete(peer.userId);

    const active = this.activePeersByUserId.get(peer.userId);
    if (active === peer) this.activePeersByUserId.delete(peer.userId);

    this.closeRoom(room);
    return wasRoomPeer;
  }

  isCurrentPeer(room: VoiceRoom, peer: VoicePeer) {
    return room.peers.get(peer.userId) === peer;
  }

  pushExistingProducers(room: VoiceRoom, peer: VoicePeer) {
    for (const [otherUserId, otherPeer] of room.peers) {
      if (otherUserId === peer.userId) continue;

      for (const producer of otherPeer.producers.values()) {
        try {
          const mediaKind =
            (producer.appData?.mediaKind as string | undefined) ??
            (producer.kind === "video" ? "camera" : "audio");
          const videoOrientation = producer.appData?.videoOrientation;

          this.push(peer, {
            op: VoiceDispatchEvents.VoiceNewProducer,
            data: {
              userId: otherUserId,
              producerId: producer.id,
              kind: producer.kind,
              mediaKind,
              ...(typeof videoOrientation === "number"
                ? { videoOrientation }
                : {}),
            },
          });
        } catch (err) {
          logger.warn(
            `pushExistingProducers: failed to push producer ${producer.id} to peer ${peer.userId}`,
            { err },
          );
        }
      }
    }
  }

  broadcast(
    room: VoiceRoom,
    message: ServerPushEnvelope,
    exceptUserId?: Snowflake,
  ) {
    const payload = JSON.stringify(message);
    const exceptKey = exceptUserId != null ? exceptUserId.toString() : null;

    for (const [userId, otherPeer] of room.peers) {
      if (exceptKey && userId.toString() === exceptKey) continue;
      try {
        otherPeer.socket.send(payload);
      } catch {
        /* empty */
      }
    }
  }

  push(peer: VoicePeer, message: ServerPushEnvelope) {
    try {
      peer.socket.send(JSON.stringify(message));
    } catch {
      /* empty */
    }
  }

  broadcastPeerJoined(room: VoiceRoom, joinedUserId: Snowflake) {
    this.broadcast(room, {
      op: VoiceDispatchEvents.VoicePeerJoined,
      data: { userId: joinedUserId },
    });
  }

  broadcastPeerLeft(room: VoiceRoom, leftUserId: Snowflake) {
    this.broadcast(room, {
      op: VoiceDispatchEvents.VoicePeerLeft,
      data: { userId: leftUserId },
    });
  }

  error(code: string, message: string) {
    const error = new Error(message) as any;
    error.code = code;
    return error;
  }
}
