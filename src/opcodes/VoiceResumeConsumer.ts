import type { Server } from "../Server";
import type { ClientMessageEnvelope, VoicePeer, VoiceRoom } from "../types";
import { Send } from "../util/Common";
import { parseData } from "../util/Validation";
import { voiceConsumerData } from "@mutualzz/validators";

export default async function VoiceResumeConsumer(
    server: Server,
    __room: VoiceRoom,
    peer: VoicePeer,
    envelope: ClientMessageEnvelope,
) {
    const { consumerId } = parseData(server, voiceConsumerData, envelope);
    const consumer = peer.consumers.get(consumerId);
    if (!consumer)
        throw server.error("CONSUMER_NOT_FOUND", "Consumer not found");

    consumer.appData.clientResumeRequested = true;
    if (!(peer.serverDeafened && consumer.kind === "audio"))
        await consumer.resume();
    Send({ ok: true }, peer, envelope);
}
