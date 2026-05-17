import type { VoicePeer } from "../types";
import type { Server } from "../Server";

export function validatePeerSession(server: Server, peer: VoicePeer) {
    const activePeer = server.activePeersByUserId.get(peer.userId);

    if (activePeer !== peer) return false;

    return activePeer.sessionId === peer.sessionId;
}
