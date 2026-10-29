import type { Server } from "../Server.ts";
import type { ClientMessageEnvelope, VoicePeer, VoiceRoom } from "../types";
import { Send } from "../util/Common";
import { parseData } from "../util/Validation";
import { voiceProducerData } from "@mutualzz/validators";

export default async function VoiceCloseProducer(
  server: Server,
  _room: VoiceRoom,
  peer: VoicePeer,
  envelope: ClientMessageEnvelope,
) {
  const { producerId } = parseData(server, voiceProducerData, envelope);

  const producer = peer.producers.get(producerId);
  if (!producer)
    throw server.error("PRODUCER_NOT_FOUND", "Producer not found");

  producer.close();

  Send({ ok: true }, peer, envelope);
}
