import type { Server } from "../Server";
import type { ClientMessageEnvelope, VoicePeer, VoiceRoom } from "../types";
import { Send, verifyVoiceToken, VOICE_SESSION_TTL_SECONDS } from "../util/Common";
import { VoiceDispatchEvents } from "@mutualzz/types";
import { redis } from "../util/Redis";
import { parseData } from "../util/Validation";
import { voiceProduceData } from "@mutualzz/validators";
import type { RtpParameters } from "mediasoup/types";

export default async function VoiceProduce(
  server: Server,
  room: VoiceRoom,
  peer: VoicePeer,
  envelope: ClientMessageEnvelope,
) {
  const { transportId, kind, rtpParameters, appData } = parseData(
    server,
    voiceProduceData,
    envelope,
  );

  if (!peer.sendTransport || peer.sendTransport.id !== transportId)
    throw server.error("BAD_TRANSPORT", "Send transport not ready");

  const voiceToken: string | null = peer.voiceToken ?? null;
  if (!voiceToken) throw server.error("UNAUTHORIZED", "Missing voice token");

  const session = await verifyVoiceToken(voiceToken);
  if (!session) throw server.error("UNAUTHORIZED", "Invalid voice token");

  const currentToken = await redis.get(`voice:currentToken:${peer.userId}`);
  if (!currentToken || currentToken !== voiceToken)
    throw server.error("UNAUTHORIZED", "Voice token has been rotated");

  if (session.userId !== peer.userId)
    throw server.error(
      "VOICE_TOKEN_MISMATCH",
      "Voice token does not match user",
    );

  if (session.roomId !== peer.roomId)
    throw server.error(
      "VOICE_TOKEN_MISMATCH",
      "Voice token does not match room",
    );

  const readVoiceState = async () => {
    const rawState = await redis.get(`voice:state:${peer.userId}`);
    if (!rawState) return null;

    try {
      return JSON.parse(rawState);
    } catch {
      throw server.error("VOICE_STATE_INVALID", "Voice state is invalid");
    }
  };

  let state: any = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    state = await readVoiceState();
    if (state) break;

    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }

  if (!state)
    throw server.error("VOICE_STATE_NOT_FOUND", "Voice state not found");

  if (!state.channelId)
    throw server.error("NOT_IN_VOICE", "User is not in a voice channel");

  if (kind === "audio") {
    const mediaKind = appData?.mediaKind;

    // Screen audio skips server mute, so it's only accepted alongside a live screen share
    if (
      mediaKind === "screen-audio" &&
      ![...peer.producers.values()].some(
        (p) => !p.closed && p.appData.mediaKind === "screen",
      )
    )
      throw server.error(
        "NO_SCREEN_SHARE",
        "Screen audio requires an active screen share",
      );

    if (
      mediaKind !== "screen-audio" &&
      (state.spaceMute === true || state.spaceDeaf === true)
    ) {
      peer.serverMuted = true;
      if (state.spaceDeaf === true) peer.serverDeafened = true;
    }
  }

  await Promise.all([
    redis.expire(`voice:sessions:${voiceToken}`, VOICE_SESSION_TTL_SECONDS),
    redis.expire(`voice:currentToken:${peer.userId}`, VOICE_SESSION_TTL_SECONDS),
  ]);

  const producer = await peer.sendTransport.produce({
    kind,
    rtpParameters: rtpParameters as unknown as RtpParameters,
    appData: {
      userId: peer.userId,
      mediaKind: appData?.mediaKind ?? (kind === "video" ? "camera" : "audio"),
      videoOrientation: appData?.videoOrientation,
    },
  });

  peer.producers.set(producer.id, producer);
  if (
    peer.serverMuted &&
    producer.kind === "audio" &&
    producer.appData.mediaKind !== "screen-audio"
  ) {
    await producer.pause();
  }

  const publishClosed = () => {
    if (!peer.producers.delete(producer.id)) return;
    server.broadcast(
      room,
      {
        op: VoiceDispatchEvents.VoiceProducerClosed,
        data: { producerId: producer.id },
      },
      peer.userId,
    );
  };

  producer.observer.on("close", publishClosed);

  if (producer.appData.mediaKind === "screen") {
    producer.observer.on("close", () => {
      for (const other of peer.producers.values()) {
        if (other.appData.mediaKind === "screen-audio") other.close();
      }
    });
  }

  Send(
    {
      ok: true,
      data: {
        producerId: producer.id,
      },
    },
    peer,
    envelope,
  );

  const videoOrientation = producer.appData.videoOrientation;
  server.broadcast(
    room,
    {
      op: VoiceDispatchEvents.VoiceNewProducer,
      data: {
        userId: peer.userId,
        producerId: producer.id,
        kind,
        mediaKind:
          producer.appData.mediaKind ?? (kind === "video" ? "camera" : "audio"),
        ...(typeof videoOrientation === "number"
          ? { videoOrientation }
          : {}),
      },
    },
    peer.userId,
  );
}
