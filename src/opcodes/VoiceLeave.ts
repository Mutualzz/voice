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
    const wasCurrent = server.cleanupPeer(room, peer);
    if (wasCurrent) {
        try {
            server.broadcastPeerLeft(room, peer.userId);
        } catch {
            /* empty */
        }
    }
    peer.socket.close(1000, "leave");
}
