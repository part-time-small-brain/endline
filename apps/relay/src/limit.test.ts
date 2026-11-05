import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { clientKey } from "./limit.ts";

const request = (remoteAddress: string, forwarded?: string) =>
  ({ socket: { remoteAddress }, headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded } }) as unknown as IncomingMessage;

describe("clientKey", () => {
  it("ignores a spoofed X-Forwarded-For unless the proxy is trusted", () => {
    expect(clientKey(request("10.0.0.1", "6.6.6.6"), false)).toBe("10.0.0.1");
  });

  it("takes the hop our proxy appended, not the one the client wrote", () => {
    expect(clientKey(request("10.0.0.1", "6.6.6.6, 1.2.3.4"), true)).toBe("1.2.3.4");
    expect(clientKey(request("10.0.0.1", "7.7.7.7, 1.2.3.4"), true)).toBe("1.2.3.4");
  });

  it("falls back to the socket when a trusted proxy sent no header", () => {
    expect(clientKey(request("10.0.0.1"), true)).toBe("10.0.0.1");
  });

  it("puts every address of one IPv6 /64 in one bucket, however it is written", () => {
    const keys = ["2001:db8:1:2::1", "2001:DB8:1:2:ffff:ffff:ffff:ffff", "2001:db8:1:2:0:0:0:9"].map((ip) => clientKey(request(ip), false));
    expect(new Set(keys)).toEqual(new Set(["2001:db8:1:2"]));
    expect(clientKey(request("2001:db8:1:3::1"), false)).not.toBe(keys[0]);
    expect(clientKey(request("2001:db8::1"), false)).toBe("2001:db8:0:0");
  });

  it("widens an IPv6 key to a /48 when asked, leaving IPv4 alone", () => {
    expect(clientKey(request("2001:db8:1:2::1"), false, 3)).toBe("2001:db8:1");
    expect(clientKey(request("2001:db8::1"), false, 3)).toBe("2001:db8:0");
    expect(clientKey(request("1.2.3.4"), false, 3)).toBe("1.2.3.4");
  });

  it("strips ports and zone ids so a client can't get a bucket per connection", () => {
    expect(clientKey(request("10.0.0.1", "1.2.3.4:5678"), true)).toBe("1.2.3.4");
    expect(clientKey(request("10.0.0.1", "[2001:db8:1:2::1]:443"), true)).toBe("2001:db8:1:2");
    expect(clientKey(request("fe80::1%eth0"), false)).toBe(clientKey(request("fe80::1%eth1"), false));
  });

  it("does not throw on a malformed forwarded address", () => {
    expect(() => clientKey(request("10.0.0.1", "1:2:3:4:5:6:7:8:9:10"), true)).not.toThrow();
  });

  it("keys IPv4-mapped IPv6 sockets as the IPv4 address", () => {
    expect(clientKey(request("::ffff:1.2.3.4"), false)).toBe("1.2.3.4");
    expect(clientKey(request("::1"), false)).toBe("0:0:0:0");
  });
});
