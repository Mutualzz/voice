import type { Server } from "../Server.ts";
import type { ClientMessageEnvelope, VoicePeer, VoiceRoom } from "../types";
import { Send } from "../util/Common";

export default async function VoiceCloseProducer(
  server: Server,
  _room: VoiceRoom,
  peer: VoicePeer,
  envelope: ClientMessageEnvelope,
) {
  const producerId = envelope.data?.producerId?.toString();
  if (!producerId)
    throw server.error("MISSING_PRODUCER_ID", "producerId required");

  const producer = peer.producers.get(producerId);
  if (!producer)
    throw server.error("PRODUCER_NOT_FOUND", "Producer not found");

  producer.close();

  Send({ ok: true }, peer, envelope);
}
