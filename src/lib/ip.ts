import { isIP } from "net";

/**
 * Rate-limit key for a client address. IPv4-mapped IPv6 (::ffff:a.b.c.d, which Node reports for
 * IPv4 peers on a dual-stack socket) is keyed as the plain IPv4 address; real IPv6 is keyed by its
 * /64, since one host usually controls a whole /64.
 */
export function ipKey(ip: string | undefined): string {
  if (!ip) return "unknown";
  const v4 = mappedV4(ip);
  if (v4) return v4;
  if (isIP(ip) === 6) {
    const groups = expand6(ip);
    if (groups) return `${groups.slice(0, 4).join(":")}::/64`;
  }
  return ip;
}

/** True for loopback, private, link-local and other non-public addresses, and for non-IPs. */
export function isPrivateIp(ip: string): boolean {
  const v4 = mappedV4(ip) ?? ip;
  const v = isIP(v4);
  if (v === 4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) {
    const l = ip.toLowerCase();
    return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe8") || l.startsWith("fe9") || l.startsWith("fea") || l.startsWith("feb");
  }
  return true;
}

/** The IPv4 address inside ::ffff:a.b.c.d or ::ffff:XXXX:XXXX, if it is one. */
function mappedV4(ip: string): string | undefined {
  if (isIP(ip) !== 6) return undefined;
  const dotted = /^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (dotted && isIP(dotted[1]) === 4) return dotted[1];
  const g = expand6(ip);
  if (g && g.slice(0, 5).every((x) => Number.parseInt(x, 16) === 0) && Number.parseInt(g[5], 16) === 0xffff) {
    const hi = Number.parseInt(g[6], 16);
    const lo = Number.parseInt(g[7], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return undefined;
}

function expand6(ip: string): string[] | null {
  if (ip.includes(".")) return null; // dotted tails are handled by mappedV4
  const [head, tail] = ip.split("::");
  const a = head ? head.split(":") : [];
  const b = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  if (tail === undefined && a.length !== 8) return null;
  const fill = Array(8 - a.length - b.length).fill("0");
  return [...a, ...fill, ...b].map((g) => g.toLowerCase());
}
