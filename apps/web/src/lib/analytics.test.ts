import { expect, it } from "vitest";
import { analyticsScript } from "./analytics.ts";

it("loads Cloudflare's beacon only on the live mainnet app, never on testnet or the mock", () => {
  expect(analyticsScript({ mock: false, network: "mainnet" })).toEqual({ src: "https://static.cloudflareinsights.com/beacon.min.js", beacon: '{"token":"a9282446496d49e0988b4b8e6d83cefe"}' });
  expect(analyticsScript({ mock: false, network: "testnet" })).toBeUndefined();
  expect(analyticsScript({ mock: true, network: "mainnet" })).toBeUndefined();
});
