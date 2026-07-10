import type { Server } from "../Server";
import type { VoicePeer, VoiceRoom } from "../types";

export default function Close(
  server: Server,
  room: VoiceRoom,
  peer: VoicePeer,
) {
  try {
    server.broadcastPeerLeft(room, peer.userId);
  } catch {
    // Ignore errors
  }

  server.cleanupPeer(room, peer);
}
