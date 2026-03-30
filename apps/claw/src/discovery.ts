/**
 * discovery.ts — 局域网 Room Server 发现（OpenClaw 客户端侧）
 * 
 * 监听 UDP beacon，发现可加入的 Room Server。
 */
import dgram from "dgram";

const DISCOVERY_PORT = 41920;
const BEACON_MAGIC = "CLAWOFFICE_BEACON_V1";

export interface DiscoveredServer {
  url: string;
  roomName: string;
  owner: string;
  clawCount: number;
  specPhase: string | null;
  gatewayId: string;
  lastSeen: number;
}

export class DiscoveryListener {
  private socket: dgram.Socket | null = null;
  private servers = new Map<string, DiscoveredServer>();
  private onDiscoveredFn: ((server: DiscoveredServer) => void) | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  onServerDiscovered(handler: (server: DiscoveredServer) => void): void {
    this.onDiscoveredFn = handler;
  }

  getServers(): DiscoveredServer[] {
    return Array.from(this.servers.values());
  }

  start(): void {
    try {
      this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

      this.socket.on("message", (data) => {
        try {
          const beacon = JSON.parse(data.toString());
          if (beacon.magic !== BEACON_MAGIC) return;

          const server: DiscoveredServer = {
            url: beacon.roomServerUrl,
            roomName: beacon.roomName,
            owner: beacon.owner,
            clawCount: beacon.clawCount,
            specPhase: beacon.specPhase,
            gatewayId: beacon.gatewayId,
            lastSeen: Date.now(),
          };

          const existing = this.servers.get(beacon.gatewayId);
          this.servers.set(beacon.gatewayId, server);

          if (!existing) {
            this.onDiscoveredFn?.(server);
          }
        } catch { /* ignore */ }
      });

      this.socket.on("error", (err) => {
        console.warn(`[Discovery] Listener error: ${err.message}`);
      });

      this.socket.bind(DISCOVERY_PORT, () => {
        console.log(`[Discovery] Listening on UDP :${DISCOVERY_PORT}`);
      });

      this.cleanupTimer = setInterval(() => {
        const cutoff = Date.now() - 15000;
        for (const [id, server] of this.servers) {
          if (server.lastSeen < cutoff) this.servers.delete(id);
        }
      }, 10000);
    } catch (err) {
      console.warn(`[Discovery] Failed to start: ${(err as Error).message}`);
    }
  }

  stop(): void {
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
    if (this.socket) { try { this.socket.close(); } catch { /* */ } this.socket = null; }
  }
}
