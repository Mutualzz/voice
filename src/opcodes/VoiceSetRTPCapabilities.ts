import type { Server } from "../Server";
import type { ClientMessageEnvelope, VoicePeer, VoiceRoom } from "../types";
import { Send } from "../util/Common";
import type { RtpCapabilities } from "mediasoup/types";
import { parseData } from "../util/Validation";
import { voiceSetRtpCapabilitiesData } from "@mutualzz/validators";

export default function VoiceSetRTPCapabilities(
    server: Server,
    room: VoiceRoom,
    peer: VoicePeer,
    envelope: ClientMessageEnvelope,
) {
    const { rtpCapabilities } = parseData(
        server,
        voiceSetRtpCapabilitiesData,
        envelope,
    );
    peer.rtpCapabilities = rtpCapabilities as unknown as RtpCapabilities;

    server.pushExistingProducers(room, peer);

    Send({ ok: true }, peer, envelope);
}
