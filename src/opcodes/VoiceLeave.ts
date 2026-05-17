import type { Server } from "../Server";
import type { ClientMessageEnvelope, VoicePeer, VoiceRoom } from "../types";
import { Send } from "../util/Common";

export default async function VoiceLeave(
    server: Server,
    room: VoiceRoom,
    peer: VoicePeer,
    envelope: ClientMessageEnvelope,
) {
    Send({ ok: true }, peer, envelope);
    server.cleanupPeer(room, peer);
    peer.socket.close(1000, "leave");
}
