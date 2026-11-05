import type { IncomingMessage } from "node:http";

// a granted call returns a function that gives its slot back, only while that window lasts
export function rateLimit(max: number, windowMs: number): (key: string) => (() => void) | undefined {
  let counts = new Map<string, number>();
  let windowEnd = 0;
  return (key) => {
    if (Date.now() >= windowEnd) {
      counts = new Map();
      windowEnd = Date.now() + windowMs;
    }
    const taken = counts;
    const count = (taken.get(key) ?? 0) + 1;
    if (count > max) return undefined;
    taken.set(key, count);
    return () => {
      if (taken === counts) taken.set(key, (taken.get(key) ?? 1) - 1);
    };
  };
}

export function clientKey(request: IncomingMessage, trustProxy: boolean, ipv6Groups = 4): string {
  const forwarded = trustProxy ? String(request.headers["x-forwarded-for"] ?? "").split(",").at(-1)?.trim() : undefined;
  const ip = (forwarded || request.socket.remoteAddress || "")
    .toLowerCase()
    .replace(/^\[(.*)\](:\d+)?$/, "$1")
    .replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, "$1")
    .replace(/^::ffff:(?=\d+\.)/, "")
    .replace(/%.*$/, "");
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.split("::");
  const front = head.split(":").filter(Boolean);
  const back = tail === undefined ? [] : tail.split(":").filter(Boolean);
  return [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back].slice(0, ipv6Groups).join(":");
}
