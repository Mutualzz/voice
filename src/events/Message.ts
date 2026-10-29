import type { ClientMessageEnvelope, VoicePeer, VoiceRoom } from "../types";
import type { Server } from "../Server";
import OPCodeHandlers, { type OPCodeHandler } from "../opcodes";
import { logger } from "../Logger";
import { Send } from "../util/Common";
import { validatePeerSession } from "../middleware/validatePeerSession";
import { voiceEnvelope } from "@mutualzz/validators";

export default async function Message(
  server: Server,
  room: VoiceRoom,
  peer: VoicePeer,
  rawText: string,
) {
  if (!validatePeerSession(server, peer)) {
    try {
      peer.socket.close(4000, "Session superseded");
    } catch {
      // Ignore errors
    }

    return;
  }

  let raw: unknown;

  try {
    raw = JSON.parse(rawText);
  } catch (err) {
    logger.error("invalid JSON", err);
    return;
  }

  const parsed = voiceEnvelope.safeParse(raw);
  if (!parsed.success) {
    logger.warn("invalid envelope", { userId: peer.userId });
    return;
  }

  const envelope = parsed.data as ClientMessageEnvelope;

  logger.debug("<-", {
    op: envelope.op,
    id: envelope.id,
    userId: peer.userId,
    roomId: peer.roomId,
  });

  const handler = Object.hasOwn(OPCodeHandlers, envelope.op)
    ? (OPCodeHandlers[envelope.op] as OPCodeHandler)
    : null;
  if (!handler) {
    logger.error(`Unknown Opcode: ${envelope.op}`);
    Send(
      {
        ok: false,
        error: { code: "UNKNOWN_OPCODE", message: "Unknown opcode" },
      },
      peer,
      envelope,
    );
    return;
  }

  try {
    await handler(server, room, peer, envelope);
  } catch (error: any) {
    logger.error("Handler error", {
      op: envelope.op,
      id: envelope.id,
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
    });

    // Only server.error() messages reach the client; anything else may carry internals
    Send(
      {
        ok: false,
        error: error?.expose
          ? { code: error.code, message: error.message }
          : { code: "INTERNAL", message: "Internal error" },
      },
      peer,
      envelope,
    );
  }
}
