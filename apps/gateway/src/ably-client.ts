import * as Ably from "ably";
import { config } from "./config.js";
import { CommandSchema } from "@office/shared";
import type { GatewayEvent, Command, UserRole } from "@office/shared";
import type { Channel, CommandMeta } from "./transport.js";

let client: Ably.Realtime | null = null;
let eventsChannel: Ably.RealtimeChannel | null = null;

/** Extract role from Ably clientId format "role:id" */
function extractRoleFromClientId(clientId?: string): { role: UserRole; clientId: string } {
  if (!clientId) return { role: "owner", clientId: "unknown" };
  const [prefix, id] = clientId.split(":", 2);
  if (prefix === "collaborator" || prefix === "spectator" || prefix === "owner") {
    return { role: prefix, clientId: id ?? clientId };
  }
  // Legacy clientId format (e.g. "device:xxx") — treat as owner for backward compat
  return { role: "owner", clientId };
}

export const ablyChannel: Channel = {
  name: "Ably",

  async init(commandHandler: (cmd: Command | { type: string; [key: string]: any }, meta: CommandMeta) => void): Promise<boolean> {
    if (!config.ablyApiKey) return false;

    client = new Ably.Realtime({ key: config.ablyApiKey });
    await client.connection.once("connected");
    console.log("[Ably] Connected");

    eventsChannel = client.channels.get(`machine:${config.machineId}:events`);
    const commandsChannel = client.channels.get(`machine:${config.machineId}:commands`);

    await commandsChannel.subscribe((msg: Ably.Message) => {
      try {
        let parsed: any;
        const result = CommandSchema.safeParse(msg.data);
        if (result.success) {
          parsed = result.data;
        } else {
          const raw = msg.data;
          if (raw && typeof raw === "object" && typeof raw.type === "string") {
            parsed = raw;
          } else {
            throw result.error;
          }
        }
        const meta = extractRoleFromClientId(msg.clientId);
        commandHandler(parsed, meta);
      } catch (err) {
        console.error("[Ably] Invalid command:", err);
      }
    });

    return true;
  },

  broadcast(event: GatewayEvent) {
    if (!eventsChannel) return;
    eventsChannel.publish(event.type, event);
  },

  destroy() {
    client?.close();
    client = null;
    eventsChannel = null;
  },
};
