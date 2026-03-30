/**
 * claw-discovery.ts — 局域网 Room Server 发现服务
 *
 * Room Server 端: 定期广播 UDP beacon，声明自己的存在。
 * OpenClaw 端: 监听 beacon，发现可加入的 Room Server。
 *
 * 协议: JSON over UDP, 端口 41920 (CLAW 的谐音)
 * 仅限局域网使用，不穿越 NAT。
 */
import dgram from "dgram";
import { networkInterfaces } from "os";

const DISCOVERY_PORT = 41920;
const BEACON_INTERVAL_MS = 5000;
const BEACON_MAGIC = "CLAWOFFICE_BEACON_V1";

// ---------------------------------------------------------------------------
// Beacon payload
// ---------------------------------------------------------------------------

export interface DiscoveryBeacon {
  magic: typeof BEACON_MAGIC;
  roomServerUrl: string;     // ws://192.168.1.10:9876
  roomName: string;
  owner: string;
  clawCount: number;
  specPhase: string | null;
  gatewayId: string;
  version: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Room Server side — 广播 beacon
// ---------------------------------------------------------------------------

export class DiscoveryBroadcaster {
  private socket: dgram.Socket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private beaconData: () => DiscoveryBeacon;

  constructor(beaconDataFn: () => DiscoveryBeacon) {
    this.beaconData = beaconDataFn;
  }

  start(): void {
    try {
      this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

      this.socket.bind(() => {
        this.socket!.setBroadcast(true);
        console.log(`[Discovery] Broadcasting on UDP :${DISCOVERY_PORT} every ${BEACON_INTERVAL_MS / 1000}s`);

        // 立即发一次
        this.sendBeacon();

        // 定期发送
        this.timer = setInterval(() => this.sendBeacon(), BEACON_INTERVAL_MS);
      });

      this.socket.on("error", (err) => {
        console.warn(`[Discovery] Broadcast socket error: ${err.message}`);
      });
    } catch (err) {
      console.warn(`[Discovery] Failed to start broadcaster: ${(err as Error).message}`);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.socket) {
      try { this.socket.close(); } catch { /* ignore */ }
      this.socket = null;
    }
  }

  private sendBeacon(): void {
    if (!this.socket) return;

    const beacon = this.beaconData();
    const msg = Buffer.from(JSON.stringify(beacon));

    // 发送到广播地址
    const broadcastAddresses = getBroadcastAddresses();
    for (const addr of broadcastAddresses) {
      try {
        this.socket.send(msg, 0, msg.length, DISCOVERY_PORT, addr);
      } catch { /* ignore individual send failures */ }
    }
  }
}

// ---------------------------------------------------------------------------
// OpenClaw side — 监听 beacon
// ---------------------------------------------------------------------------

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
  private onDiscovered: ((server: DiscoveredServer) => void) | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** 注册发现回调 */
  onServerDiscovered(handler: (server: DiscoveredServer) => void): void {
    this.onDiscovered = handler;
  }

  /** 获取当前已发现的服务器列表 */
  getServers(): DiscoveredServer[] {
    return Array.from(this.servers.values());
  }

  start(): void {
    try {
      this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

      this.socket.on("message", (data, rinfo) => {
        try {
          const beacon: DiscoveryBeacon = JSON.parse(data.toString());
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

          // 只在首次发现时回调
          if (!existing) {
            this.onDiscovered?.(server);
          }
        } catch { /* ignore malformed beacons */ }
      });

      this.socket.on("error", (err) => {
        console.warn(`[Discovery] Listener error: ${err.message}`);
      });

      this.socket.bind(DISCOVERY_PORT, () => {
        console.log(`[Discovery] Listening for beacons on UDP :${DISCOVERY_PORT}`);
      });

      // 清理过期的服务器 (15秒没收到 beacon = 离线)
      this.cleanupTimer = setInterval(() => {
        const cutoff = Date.now() - 15000;
        for (const [id, server] of this.servers) {
          if (server.lastSeen < cutoff) {
            this.servers.delete(id);
          }
        }
      }, 10000);
    } catch (err) {
      console.warn(`[Discovery] Failed to start listener: ${(err as Error).message}`);
    }
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.socket) {
      try { this.socket.close(); } catch { /* ignore */ }
      this.socket = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBroadcastAddresses(): string[] {
  const addresses: string[] = [];
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal && net.netmask) {
        // 计算广播地址
        const ip = net.address.split(".").map(Number);
        const mask = net.netmask.split(".").map(Number);
        const broadcast = ip.map((octet, i) => (octet | (~mask[i] & 255)));
        addresses.push(broadcast.join("."));
      }
    }
  }

  // Fallback
  if (addresses.length === 0) {
    addresses.push("255.255.255.255");
  }

  return addresses;
}

export { DISCOVERY_PORT, BEACON_MAGIC };
