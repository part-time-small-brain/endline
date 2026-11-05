import { describe, expect, it } from "vitest";
import { positionStatus, seriesStatus } from "./status.ts";

const EXPIRY = 1_800_000_000;
const CUTOFF = 1_800;

describe("seriesStatus", () => {
  it("closes cash-out exactly at the write cutoff", () => {
    expect(seriesStatus(EXPIRY, CUTOFF, null, EXPIRY - CUTOFF - 1)).toBe("active");
    expect(seriesStatus(EXPIRY, CUTOFF, null, EXPIRY - CUTOFF)).toBe("close_only");
    expect(seriesStatus(EXPIRY, CUTOFF, null, EXPIRY - 1)).toBe("close_only");
  });

  it("waits for a price from expiry until one is proposed", () => {
    expect(seriesStatus(EXPIRY, CUTOFF, null, EXPIRY)).toBe("awaiting_price");
    expect(seriesStatus(EXPIRY, CUTOFF, null, EXPIRY + 86_400)).toBe("awaiting_price");
  });

  it("is final only from final_at on", () => {
    const settlement = { price: 1n, finalAt: EXPIRY + 3_600 };
    expect(seriesStatus(EXPIRY, CUTOFF, settlement, EXPIRY + 3_599)).toBe("proposed");
    expect(seriesStatus(EXPIRY, CUTOFF, settlement, EXPIRY + 3_600)).toBe("final");
  });
});

describe("positionStatus", () => {
  it("waits for collect eligibility without delaying paid or zero-payout positions", () => {
    expect(positionStatus("final", 5n, 10n, false)).toBe("settling");
    expect(positionStatus("final", 5n, 10n, true)).toBe("collect");
    expect(positionStatus("final", 5n, 0n, false)).toBe("paid");
    expect(positionStatus("final", 0n, 10n, false)).toBe("expired");
  });

  it("asks to collect only once final, with something owed and still held", () => {
    expect(positionStatus("final", 5n, 10n)).toBe("collect");
    expect(positionStatus("final", 5n, 0n)).toBe("paid");
    expect(positionStatus("final", 0n, 10n)).toBe("expired");
    expect(positionStatus("proposed", 5n, 10n)).toBe("settling");
  });
});
