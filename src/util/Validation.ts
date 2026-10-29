import type { z } from "zod";
import type { Server } from "../Server";
import type { ClientMessageEnvelope } from "../types";

export const parseData = <T extends z.ZodType>(
  server: Server,
  schema: T,
  envelope: ClientMessageEnvelope,
): z.output<T> => {
  const result = schema.safeParse(envelope.data);
  if (!result.success)
    throw server.error("INVALID_PAYLOAD", "Invalid request data");
  return result.data;
};
