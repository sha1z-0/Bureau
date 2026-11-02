import net from 'node:net';

/**
 * Is this address somewhere Bureau must never fetch from? Works on raw bytes, so
 * every spelling of an address is judged the same: `127.0.0.1`, `::ffff:7f00:1`,
 * `::127.0.0.1`, `64:ff9b::7f00:1` and `2002:7f00:1::` are all loopback.
 */

const V4_BLOCKS: [number, number][] = [
  [0x00000000, 8], // "this" network
  [0x0a000000, 8], // private
  [0x64400000, 10], // carrier-grade NAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link-local, cloud metadata
  [0xac100000, 12], // private
  [0xc0000000, 24], // IETF protocol assignments
  [0xc0000200, 24], // TEST-NET-1
  [0xc0586300, 24], // 6to4 relay anycast
  [0xc0a80000, 16], // private
  [0xc6120000, 15], // benchmarking
  [0xc6336400, 24], // TEST-NET-2
  [0xcb007100, 24], // TEST-NET-3
  [0xe0000000, 3], // multicast + reserved + broadcast (224/3)
];

function v4Blocked(n: number): boolean {
  return V4_BLOCKS.some(([base, bits]) => (bits === 0 ? true : (n >>> (32 - bits)) === base >>> (32 - bits)));
}

function parseV4(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => !(n >= 0 && n <= 255))) return null;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

/** Expand an IPv6 literal to eight 16-bit groups. */
function parseV6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, '');
  // Rewrite a trailing dotted quad (::ffff:1.2.3.4) as two hex groups.
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = parseV4(dotted[1]);
    if (v4 === null) return null;
    s = `${s.slice(0, -dotted[1].length)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const groups = (part: string) => (part ? part.split(':').map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN)) : []);
  const left = groups(halves[0]);
  const right = halves.length === 2 ? groups(halves[1]) : [];
  const fill = 8 - left.length - right.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const out = [...left, ...new Array(halves.length === 2 ? fill : 0).fill(0), ...right];
  return out.length === 8 && out.every((g) => g >= 0 && g <= 0xffff) ? out : null;
}

export function isBlockedIp(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, '');
  if (net.isIPv4(ip)) return v4Blocked(parseV4(ip)!);
  if (!net.isIPv6(ip)) return true; // not an IP we understand: refuse
  const g = parseV6(ip);
  if (!g) return true;
  const embedded = (hi: number, lo: number) => v4Blocked(((hi << 16) | lo) >>> 0);

  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return embedded(g[6], g[7]); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return true; // ::, ::1, IPv4-compatible ::a.b.c.d — never legitimate
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]); // 6to4
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard-only
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}
