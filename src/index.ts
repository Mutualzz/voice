import { Server } from "./Server.ts";
import { logger } from "./Logger.ts";
import type Redis from "ioredis";
import { redis } from "./util/Redis.ts";

let redisSubscriber: Redis | null = null;
const voice = new Server();

process.on("SIGTERM", async () => {
  logger.warn("Shutting down due to SIGTERM");

  await voice.stop();
});

async function main() {
  try {
    const sub = redis.duplicate();
    redisSubscriber = sub;

    sub.on("message", (channel, message) => {
      if (channel !== "voice:control:kick") return;

      try {
        const data = JSON.parse(message);
        const userId = data.userId;
        const reason = data.reason ?? "Kicked from voice";
        const spaceId = data.spaceId ?? null;

        const ok = voice.kickPeerByUserId(userId, 4000, reason);
        if (!ok)
          logger.debug("kickPeerByUserId: user not found on voice server", {
            userId,
            spaceId,
          });
        else
          logger.info("kicked voice peer via control channel", {
            userId,
          });
      } catch (err) {
        logger.error("Failed to handle voice control message", err);
      }
    });

    await sub.subscribe("voice:control:kick");
    logger.info("Voice control subscriber initialized");
  } catch (err) {
    logger.error("Failed to initialize voice Redis subscriber", err);
  }
  await voice.start();
}

main().catch((error) => {
  logger.error("Error starting server", error);
});
