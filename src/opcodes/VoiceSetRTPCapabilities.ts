import type { Server } from "../Server";
import type { ClientMessageEnvelope, VoicePeer, VoiceRoom } from "../types";
import { Send } from "../util/Common";
import type { RtpCapabilities } from "mediasoup/types";

export default function VoiceSetRTPCapabilities(
    server: Server,
    room: VoiceRoom,
    peer: VoicePeer,
    envelope: ClientMessageEnvelope,
) {
    peer.rtpCapabilities = envelope.data?.rtpCapabilities as RtpCapabilities;

    server.pushExistingProducers(room, peer);

    Send({ ok: true }, peer, envelope);
}
