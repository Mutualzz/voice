import type { Server } from "../Server";
import type { ClientMessageEnvelope, VoicePeer, VoiceRoom } from "../types";
import { Send } from "../util/Common";

export default function VoiceAuthenticate(
  _server: Server,
  _room: VoiceRoom,
  peer: VoicePeer,
  envelope: ClientMessageEnvelope,
) {
  Send({ ok: true, data: {} }, peer, envelope);
}
