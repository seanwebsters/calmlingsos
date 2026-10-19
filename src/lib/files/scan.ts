import "server-only";
import net from "node:net";
import { env } from "@/lib/env";

export interface ScanResult {
  scanned: boolean;
  clean: boolean;
  engine: string | null;
  detail: string;
}

/**
 * Malware scanning integration point. With CLAMAV_ADDRESS (host:port) set,
 * files are streamed to clamd using the INSTREAM protocol. Without it, the
 * upload is reported as "not scanned" – never as clean.
 */
export async function scanBuffer(buf: Buffer): Promise<ScanResult> {
  if (!env.clamavAddress) return { scanned: false, clean: true, engine: null, detail: "No malware scanner configured." };
  const [host, portStr] = env.clamavAddress.split(":");
  const port = Number(portStr ?? 3310);
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port }, () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < buf.length; i += 64 * 1024) {
        const chunk = buf.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        sock.write(len);
        sock.write(chunk);
      }
      sock.write(Buffer.alloc(4));
    });
    let reply = "";
    sock.setTimeout(60_000, () => {
      sock.destroy();
      resolve({ scanned: false, clean: false, engine: "clamav", detail: "Scanner timed out – upload refused." });
    });
    sock.on("data", (d) => (reply += d.toString()));
    sock.on("error", (e) => resolve({ scanned: false, clean: false, engine: "clamav", detail: `Scanner unavailable (${e.message}) – upload refused.` }));
    sock.on("end", () => {
      const r = reply.replace(/\0/g, "").trim();
      resolve({ scanned: true, clean: /OK$/.test(r), engine: "clamav", detail: r });
    });
  });
}
