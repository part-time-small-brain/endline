import { describe, expect, it } from "vitest";
import { pendingAlerts, reserveAlert, settlementAlert, type Contract } from "./alerts.ts";
import type { PendingChanges, ProposedSettlement } from "./chain.ts";

const CONTRACT: Contract = {
  optionsId: "opt6.near-options-dev.testnet",
  networkId: "testnet",
  ownerId: "owner.testnet",
  oracles: ["oracle.testnet"],
  quoteDecimals: 6,
  oracleWindowSec: 600,
};
const EXPIRY = 1_792_828_800 + 60;
const DELIVERY_EXPIRY = 1_792_828_800;
const FINAL_AT = EXPIRY + 720;
const proposed = (price: string): ProposedSettlement => ({ price, final_at: FINAL_AT, proposed_by: "outlayer.testnet" });
const check = (settlement: ProposedSettlement | null, reference: number | undefined, { nowSec = FINAL_AT - 1, contract = CONTRACT, expiry = EXPIRY } = {}) =>
  settlementAlert(contract, { underlying: "BTC", expiry, settlement, reference }, nowSec);

describe("settlementAlert", () => {
  it("accepts a proposal exactly 20 bps off, measured against the lower price like the oracle", () => {
    expect(check(proposed("10020000000"), 10_000)).toBeUndefined();
    expect(check(proposed("10000000000"), 10_020)).toBeUndefined();
  });

  it("alerts one quote unit past 20 bps, the oracle's own Deribit veto, and 20 bps below the reference", () => {
    expect(check(proposed("10020000001"), 10_000)?.key).toBe(`settle BTC ${EXPIRY}`);
    expect(check(proposed("9980000000"), 10_000)?.key).toBe(`settle BTC ${EXPIRY}`);
  });

  it("gives 08:00 expiries the same 20 bps, since the oracle settles on the exchange median, not Deribit", () => {
    const delivery = (price: string) => check(proposed(price), 10_000, { expiry: DELIVERY_EXPIRY });
    expect(delivery("10012000000")).toBeUndefined();
    expect(delivery("10020000001")?.key).toBe(`settle BTC ${DELIVERY_EXPIRY}`);
  });

  it("prints an owner override with the price left for a human to work out, Deribit shown only as a reference", () => {
    const text = check(proposed("90000000000"), 80_705.19)?.text;
    expect(text).toContain("Deribit 80705.19 (1152 bps off)");
    expect(text).toContain(
      `near contract call-function as-transaction opt6.near-options-dev.testnet override_settlement json-args '{"underlying":"BTC","expiry":${EXPIRY},"price":"<price>"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as owner.testnet network-config testnet`,
    );
  });

  it("signs mainnet commands quietly with the admin key from the environment and deletes near CLI's command log, testnet ones from the keychain", () => {
    const mainnet = { ...CONTRACT, networkId: "mainnet" };
    expect(check(proposed("90000000000"), 80_705.19, { contract: mainnet })?.text).toMatch(/near --quiet contract call-function as-transaction opt6\.near-options-dev\.testnet override_settlement .* sign-as owner\.testnet network-config mainnet sign-with-plaintext-private-key "\$OWNER_PRIVATE_KEY" send; rm -f "\$TMPDIR\/near-cli-rs-final-command\.log"$/);
    expect(check(null, 80_000, { nowSec: EXPIRY + 900, contract: mainnet })?.text).toMatch(/near --quiet contract call-function as-transaction .* sign-as oracle\.testnet network-config mainnet sign-with-plaintext-private-key "\$ORACLE_PRIVATE_KEY" send; rm -f "\$TMPDIR\/near-cli-rs-final-command\.log"$/);
    expect(check(null, 80_000, { nowSec: EXPIRY + 900 })?.text).toMatch(/network-config testnet sign-with-legacy-keychain send$/);
  });

  it("stays silent once the price is final, however wrong", () => {
    expect(check(proposed("1"), 80_000, { nowSec: FINAL_AT })).toBeUndefined();
    expect(check(proposed("1"), undefined, { nowSec: FINAL_AT + 1 })).toBeUndefined();
  });

  it("alerts an unverifiable proposal under the same key as a deviation, so a flapping reference doesn't resend it", () => {
    const alert = check(proposed("80000000000"), undefined);
    expect(alert?.key).toBe(check(proposed("80000000000"), 90_000)?.key);
    expect(alert?.text).toContain("no Deribit reference");
    expect(alert?.title).toBe(`Can't check the settlement price for BTC ${new Date(EXPIRY * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`);
    expect(check(proposed("80000000000"), 90_000)?.title).toMatch(/^Settlement price for BTC .* UTC looks wrong$/);
    expect(alert?.text).toContain(`"price":"<price>"`);
  });

  it("waits five minutes past the oracle window, the proposer's first chance, before asking for a manual proposal", () => {
    expect(check(null, 80_000, { nowSec: EXPIRY + 899 })).toBeUndefined();
    const alert = check(null, 80_000, { nowSec: EXPIRY + 900 });
    expect(alert?.key).toBe(`missing BTC ${EXPIRY}`);
    expect(alert?.text).toContain(`propose_settlement json-args '{"underlying":"BTC","expiry":${EXPIRY},"price":"<price>"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as oracle.testnet`);
  });

  it("tells the proposer the deadline to reproduce the price with all venues, and its units", () => {
    const text = check(null, 80_000, { nowSec: EXPIRY + 900 })?.text;
    expect(text).toContain(`Run the pinned WASM before ${new Date((EXPIRY + 11 * 3_600) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`);
    expect(text).toContain("6 decimals ($74,784.91 = 74784910000)");
  });

  it("still asks for a manual proposal with no reference and no oracle account", () => {
    const text = check(null, undefined, { nowSec: EXPIRY + 10_000, contract: { ...CONTRACT, oracles: [] } })?.text;
    expect(text).toContain(`"price":"<price>"`);
    expect(text).toContain("sign-as <oracle>");
  });
});

describe("reserveAlert", () => {
  const STORAGE_BYTES = 100_000;
  const STORAGE_YOCTO = 10n ** 24n;
  const TWO_NEAR = 2n * 10n ** 24n;

  it("alerts one yocto below 2 NEAR over the storage cost, not at it", () => {
    expect(reserveAlert("Relayer", CONTRACT.optionsId, STORAGE_YOCTO + TWO_NEAR, STORAGE_BYTES, TWO_NEAR)).toBeUndefined();
    expect(reserveAlert("Relayer", CONTRACT.optionsId, STORAGE_YOCTO + TWO_NEAR - 1n, STORAGE_BYTES, TWO_NEAR)?.key).toBe(`reserve ${CONTRACT.optionsId}`);
  });

  it("keys each account separately, so a low relayer doesn't hide a low intents contract", () => {
    const keys = ["intents.testnet", "relayer.testnet"].map((id) => reserveAlert("Relayer", id, TWO_NEAR - 1n, 0, TWO_NEAR)?.key);
    expect(keys).toEqual(["reserve intents.testnet", "reserve relayer.testnet"]);
  });

  it("reports a balance below the storage cost as negative", () => {
    expect(reserveAlert("Relayer", CONTRACT.optionsId, STORAGE_YOCTO / 2n, STORAGE_BYTES, TWO_NEAR)?.text).toContain("-0.500 NEAR above storage");
  });
});

describe("pendingAlerts", () => {
  const wasm = (active_at: number) => ({ oracle_wasm: { outlayer_id: "outlayer.testnet", url: "https://x/oracle.wasm", sha256: "ab".repeat(32) }, active_at });
  const keys = (changes: Partial<PendingChanges>) => pendingAlerts(CONTRACT.optionsId, { oracles: [], oracle_wasm: null, pending_owner_id: null, ...changes }).map((a) => a.key);

  it("alerts again when a pending WASM is replaced by the same sha256, since the delay restarts", () => {
    expect(keys({ oracle_wasm: wasm(EXPIRY) })).not.toEqual(keys({ oracle_wasm: wasm(EXPIRY + 1) }));
  });

  it("alerts again when an oracle is removed and re-added between checks", () => {
    expect(keys({ oracles: [["a.testnet", EXPIRY]] })).not.toEqual(keys({ oracles: [["a.testnet", EXPIRY + 60]] }));
  });
});
