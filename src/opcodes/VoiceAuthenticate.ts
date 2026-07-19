import type { Server } from "../Server";
import type { ClientMessageEnvelope, VoicePeer, VoiceRoom } from "../types";
import { Send } from "../util/Common";

export default function VoiceAuthenticate(
  _server: Server,
  room: VoiceRoom,
  peer: VoicePeer,
  envelope: ClientMessageEnvelope,
) {
  Send(
    {
      ok: true,
      data: {
        rtpCapabilities: room.router.rtpCapabilities,
      },
    },
    peer,
    envelope,
  );
}
