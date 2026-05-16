import { Server } from "apps/voice/src/index";
import type { VoicePeer } from "apps/voice/src/types.ts";

export function validatePeerSession(server: Server, peer: VoicePeer) {
    const activePeer = server.activePeersByUserId.get(peer.userId);

    if (activePeer !== peer) return false;

    return activePeer.sessionId === peer.sessionId;
}
