import { Server } from "./Server.ts";
import { logger } from "./Logger.ts";

const voice = new Server();

process.on("SIGTERM", async () => {
    logger.warn("Shutting down due to SIGTERM");

    await voice.stop();
});

async function main() {
    await voice.start();
}

main().catch((error) => {
    logger.error("Error starting server", error);
});
