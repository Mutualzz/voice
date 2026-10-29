import type { Server } from "../Server";
import type { ClientMessageEnvelope, VoicePeer, VoiceRoom } from "../types";
import type { DtlsParameters } from "mediasoup/types";
import { Send } from "../util/Common";
import { parseData } from "../util/Validation";
import { voiceConnectTransportData } from "@mutualzz/validators";

export default async function VoiceConnectTransport(
    server: Server,
    _room: VoiceRoom,
    peer: VoicePeer,
    envelope: ClientMessageEnvelope,
) {
    const data = parseData(server, voiceConnectTransportData, envelope);
    const transportId = data.transportId;
    const dtlsParameters = data.dtlsParameters as unknown as DtlsParameters;

    const transport =
        peer.sendTransport?.id === transportId
            ? peer.sendTransport
            : peer.receiverTransport?.id === transportId
              ? peer.receiverTransport
              : undefined;

    if (!transport)
        throw server.error("TRANSPORT_NOT_FOUND", "Transport not found");

    if ((transport as { dtlsState?: string }).dtlsState === "connected") {
        Send({ ok: true }, peer, envelope);
        return;
    }

    await transport.connect({ dtlsParameters });

    Send(
        {
            ok: true,
        },
        peer,
        envelope,
    );
}
