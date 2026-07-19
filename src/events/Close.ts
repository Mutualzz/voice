import type { Server } from "../Server";
import type { VoicePeer, VoiceRoom } from "../types";

export default function Close(
  server: Server,
  room: VoiceRoom,
  peer: VoicePeer,
) {
  const wasCurrent = server.isCurrentPeer(room, peer);
  server.cleanupPeer(room, peer);
  if (!wasCurrent) return;

  try {
    server.broadcastPeerLeft(room, peer.userId);
  } catch {
    /* empty */
  }
}
