import { buyDiffs, type Call, callableAt, callPoints, type Fill, FREE_CALLS_PER_ROUND, intentsAssetId, isListed, longPayout, MIN_RELAYED_PAYOUT_USD, payload, type Quote, nextRound, readPayload, roundOf, type Series, sellDiffs, type Standing, type StatusUpdate, termsOf, tokenDiff, toSign } from "@endline/sdk";
import { base58 } from "@scure/base";
import type { Chain } from "../api/chain.ts";
import type { Market } from "../api/market.ts";
import type { DepositStatus, OneClick } from "../api/oneClick.ts";
import { type Relay, RelayError } from "../api/relay.ts";
import type { Config } from "../config.ts";
import { toUnits } from "../lib/money.ts";
import { costOf } from "../lib/payoff.ts";
import type { Services } from "../services.ts";
import { exampleMark } from "./marks.ts";
import { createWorld, QUOTE_DECIMALS, START_BALANCE, type Underlying, UNDERLYINGS, WRITE_CUTOFF_SEC } from "./world.ts";

const MM_DEADLINE_MS = 25_000;
const SIGN_MARGIN_MS = 3_000;
const SETTLE_DELAY_MS = 1_200;
const PROPOSE_AFTER_SEC = 120;
const DISPUTE_SEC = 3_600;
const FINAL_MARGIN_SEC = 60;
const PLAYERS: [string, number, number, number][] = [
  ["sun.near", 1_250, 4, 3],
  ["kite.near", 980, 3, 1],
  ["orbit.near", 640, 2, 2],
  ["0x5a1fe0d2c36e3b6f4d2b1a9c8e7f6a5b4c3d2e1f", 410, 2, 0],
  ["nova.near", 150, 1, 1],
  ["pike.near", -100, 0, 0],
];
const DEPOSIT_STEP_MS = 4_000;
const FAUCET_AMOUNT = 100_000_000n;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function relayable(deadline: string) {
  const left = Date.parse(deadline) - Date.now();
  if (left < 2 * 60_000 || left > 10 * 60_000) throw new RelayError("a payload must expire between 2 and 10 minutes from now", 400);
}
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const txHash = () => base58.encode(randomBytes(32));
const nowSec = () => Math.floor(Date.now() / 1000);
const quotable = (s: Series) => s.expiry - nowSec() > WRITE_CUTOFF_SEC && isListed(s, QUOTE_DECIMALS);

export function createMockServices(config: Config): Services {
  const world = createWorld();
  const balancesOf = new Map<string, Map<string, bigint>>();
  const fills: Fill[] = [];
  const issued = new Map<string, { quote: Quote; account: string; status: StatusUpdate }>();
  const deposits = new Map<string, { startedAt: number; amount: bigint; account: string; credited: boolean }>();
  const dripped = new Set<string>();
  const called: Call[] = [];
  const option = (seriesId: string) => intentsAssetId(config.optionsId, seriesId);
  const markOf = (s: Series) => exampleMark(s, world.spot[s.underlying as Underlying], UNDERLYINGS[s.underlying as Underlying].vol, nowSec(), QUOTE_DECIMALS);

  function wallet(account: string): Map<string, bigint> {
    let balances = balancesOf.get(account);
    if (!balances) {
      const implicit = /^[0-9a-f]{64}$/.test(account);
      balances = new Map([[config.quoteAsset, implicit ? 0n : START_BALANCE]]);
      balancesOf.set(account, balances);
      for (const h of implicit ? [] : world.holdings) {
        balances.set(option(h.series.id), h.size);
        fills.push({
          quote_id: crypto.randomUUID(),
          series_id: h.series.id,
          side: "buy",
          account_id: account,
          size: h.size.toString(),
          premium: h.premium.toString(),
          tx_hash: txHash(),
          at_ms: Date.now() - h.boughtAgoSec * 1000,
        });
      }
    }
    return balances;
  }

  const move = (account: string, asset: string, delta: bigint) => {
    const balances = wallet(account);
    balances.set(asset, (balances.get(asset) ?? 0n) + delta);
  };

  const relay: Relay = {
    async listing() {
      return {
        quote_asset: config.quoteAsset,
        quote_decimals: QUOTE_DECIMALS,
        series: world.series.map((s) => ({ ...s, option_asset: option(s.id), quotable: quotable(s) })),
      };
    },
    marks: async () => world.series.filter(quotable).flatMap((s) => markOf(s) ?? []),
    async quote(request) {
      await sleep(350 + Math.random() * 400);
      const series = world.series.find((s) => s.id === request.series_id);
      if (!series || !quotable(series)) throw new Error("series is not quotable");
      const mark = markOf(series);
      const perContract = BigInt((request.side === "buy" ? mark?.ask : mark?.bid) ?? 0);
      const jittered = (perContract * BigInt(Math.round(9_850 + Math.random() * 180))) / 10_000n;
      const size = BigInt(request.size);
      const { unit } = termsOf(series);
      const premium = request.side === "buy" ? costOf(size, jittered, unit) : (size * jittered) / unit;
      if (premium <= 0n) throw new Error("size too small to quote");
      const trade = { option: option(series.id), quote: config.quoteAsset, size, premium, pips: 1n };
      const userLeg = (request.side === "buy" ? buyDiffs(trade) : sellDiffs(trade)).user;
      const signBy = Date.now() + MM_DEADLINE_MS - SIGN_MARGIN_MS;
      const p = payload(config.intentsId, request.signer.signer_id, signBy, randomBytes(4), randomBytes(15), [tokenDiff(userLeg)]);
      const cash = { asset: config.quoteAsset, amount: premium.toString() };
      const opt = { asset: trade.option, amount: request.size };
      const quote: Quote = {
        quote_id: crypto.randomUUID(),
        series_id: series.id,
        side: request.side,
        size: request.size,
        premium: premium.toString(),
        pay: request.side === "buy" ? cash : opt,
        receive: request.side === "buy" ? opt : cash,
        sign_by_ms: signBy,
        payload: toSign(request.signer.standard, p),
      };
      issued.set(quote.quote_id, { quote, account: request.signer.signer_id, status: { quote_id: quote.quote_id, status: "open" } });
      return quote;
    },
    async publish({ quote_id }) {
      const entry = issued.get(quote_id);
      if (!entry || entry.status.status !== "open") throw new Error("unknown or used quote");
      await sleep(SETTLE_DELAY_MS);
      const { quote, account } = entry;
      const paying = BigInt(quote.pay.amount);
      if (Date.now() > quote.sign_by_ms) entry.status = { quote_id, status: "expired" };
      else if ((wallet(account).get(quote.pay.asset) ?? 0n) < paying) entry.status = { quote_id, status: "failed", reason: "balance changed" };
      else {
        move(account, quote.pay.asset, -paying);
        move(account, quote.receive.asset, BigInt(quote.receive.amount));
        const hash = txHash();
        fills.push({ quote_id, series_id: quote.series_id, side: quote.side, account_id: account, size: quote.size, premium: quote.premium, tx_hash: hash, at_ms: Date.now() });
        entry.status = { quote_id, status: "settled", tx_hash: hash };
      }
      return entry.status;
    },
    async status(quoteId) {
      const entry = issued.get(quoteId);
      if (!entry) throw new Error("unknown quote");
      return entry.status;
    },
    async fills(accountId) {
      wallet(accountId);
      return fills.filter((fill) => fill.account_id === accountId);
    },
    async execute(signed) {
      const message = readPayload(signed);
      relayable(message.deadline);
      await sleep(SETTLE_DELAY_MS);
      const [intent] = message.intents;
      const legs = Object.entries(intent?.intent === "transfer" ? intent.tokens : {}).map(([asset, amount]) => {
        const series = world.series.find((s) => option(s.id) === asset);
        const settlement = series && world.settlements.get(`${series.underlying}:${series.expiry}`);
        if (!series || !settlement || settlement.finalAt > nowSec()) throw new Error("price is not final yet");
        return { asset, amount: BigInt(amount), payout: longPayout(termsOf(series), BigInt(amount), settlement.price) };
      });
      if (legs.reduce((sum, leg) => sum + leg.payout, 0n) < MIN_RELAYED_PAYOUT_USD * 10n ** BigInt(QUOTE_DECIMALS)) {
        throw new RelayError("the relay pays gas only for payouts of at least $1: collect from a NEAR wallet", 400);
      }
      for (const { asset, amount, payout } of legs) {
        move(message.signer_id, asset, -amount);
        move(message.signer_id, config.quoteAsset, payout);
      }
      return txHash();
    },
    async transfer(signed) {
      const { signer_id, intents, deadline } = readPayload(signed);
      relayable(deadline);
      await sleep(SETTLE_DELAY_MS);
      const moves = intents.flatMap((intent) => (intent.intent === "transfer" ? Object.entries(intent.tokens).map(([asset, amount]) => ({ to: intent.receiver_id, asset, amount: BigInt(amount) })) : []));
      const total = moves.reduce((sum, { amount }) => sum + amount, 0n);
      if (total > (wallet(signer_id).get(config.quoteAsset) ?? 0n)) throw new RelayError("balance not enough", 422);
      for (const { to, asset, amount } of moves) {
        move(signer_id, asset, -amount);
        move(to, asset, amount);
      }
      return txHash();
    },
    relayerId: async () => "relayer.near",
    claim: () => sleep(SETTLE_DELAY_MS),
    async faucet(accountId) {
      await sleep(SETTLE_DELAY_MS);
      if (dripped.has(accountId)) throw new RelayError("this account already got test USDC in the last 24 hours", 429);
      dripped.add(accountId);
      move(accountId, config.quoteAsset, FAUCET_AMOUNT);
      return txHash();
    },
    async call({ series_id, signer }) {
      await sleep(250);
      const series = world.series.find((s) => s.id === series_id);
      if (!series) throw new RelayError("unknown series", 404);
      const callable = (s: Series) => quotable(s) && callableAt(s.expiry, nowSec());
      if (!callable(series)) throw new RelayError("the final round has started: calls close when the averaging window opens", 409);
      const round = roundOf(series.expiry);
      if (round !== nextRound(world.series.filter(callable).map((s) => s.expiry))) throw new RelayError("free calls are open only for the next round", 409);
      if ((wallet(signer.signer_id).get(config.quoteAsset) ?? 0n) < 10n ** BigInt(QUOTE_DECIMALS)) throw new RelayError("a free call needs at least $1 of USDC in your NEAR Intents balance: deposit first", 402);
      const mine = called.filter((c) => c.account_id === signer.signer_id);
      if (mine.some((c) => c.series_id === series_id)) throw new RelayError("you already called this cell", 409);
      const mark = markOf(series);
      if (!mark) throw new RelayError("no price for this cell right now", 503);
      if (BigInt(mark.ask) >= BigInt(series.width)) throw new RelayError("this cell can't pay more than it costs", 409);
      if (mine.filter((c) => roundOf(c.terms.expiry) === round).length >= FREE_CALLS_PER_ROUND) throw new RelayError(`you've used your ${FREE_CALLS_PER_ROUND} free calls for this round`, 429);
      const { id, ...terms } = series;
      const call = { series_id: id, account_id: signer.signer_id, terms, ask: mark.ask, at_ms: Date.now() };
      called.push(call);
      return call;
    },
    async calls(accountId) {
      await score();
      return called.filter((c) => c.account_id === accountId).sort((a, b) => b.at_ms - a.at_ms);
    },
    async leaderboard(accountId) {
      await score();
      const scored = called.filter((c) => c.result);
      const round = scored.map((c) => roundOf(c.terms.expiry)).sort().at(-1) ?? roundOf(lastSettled());
      const players = new Map(PLAYERS.map(([id, points, wins, streak]) => [id, { points, wins, streak }]));
      for (const c of scored.filter((c) => roundOf(c.terms.expiry) === round)) {
        const player = players.get(c.account_id) ?? { points: 0, wins: 0, streak: 0 };
        player.points += c.result?.points ?? 0;
        if ((c.result?.points ?? 0) > 0) player.wins += 1;
        player.streak = player.wins > 0 ? Math.max(player.streak, 1) : 0;
        players.set(c.account_id, player);
      }
      const standings: Standing[] = [...players]
        .sort(([a, x], [b, y]) => y.points - x.points || y.wins - x.wins || (a < b ? -1 : 1))
        .map(([account_id, p], i) => ({ account_id, rank: i + 1, ...p }));
      const you = standings.find((s) => s.account_id === accountId) ?? null;
      return { round, today: standings, week: standings, ...(accountId === undefined ? {} : { you: { today: you, week: you } }) };
    },
  };

  async function score() {
    for (const call of called.filter((c) => !c.result && c.terms.expiry <= nowSec())) {
      const settlement = await chain.settlement(call.terms.underlying, call.terms.expiry);
      if (settlement && nowSec() >= settlement.finalAt + FINAL_MARGIN_SEC) call.result = { price: settlement.price.toString(), points: callPoints(termsOf(call.terms), BigInt(call.ask), settlement.price) };
    }
  }

  function lastSettled() {
    return Math.max(world.start, ...[...world.settlements.keys()].map((key) => Number(key.split(":")[1])));
  }

  const chain: Chain = {
    contract: async () => ({
      timing: { write_cutoff_sec: WRITE_CUTOFF_SEC },
      quoteDecimals: QUOTE_DECIMALS,
      decimals: Object.fromEntries(Object.entries(UNDERLYINGS).map(([symbol, u]) => [symbol, u.decimals])),
    }),
    async balances(accountId, assets) {
      const balances = wallet(accountId);
      return Object.fromEntries(assets.map((asset) => [asset, balances.get(asset) ?? 0n]));
    },
    async settlement(underlying, expiry) {
      const key = `${underlying}:${expiry}`;
      if (!world.settlements.has(key) && expiry > world.start && nowSec() >= expiry + PROPOSE_AFTER_SEC) {
        world.settlements.set(key, { price: toUnits(world.spot[underlying as Underlying], QUOTE_DECIMALS), finalAt: expiry + PROPOSE_AFTER_SEC + DISPUTE_SEC });
      }
      return world.settlements.get(key) ?? null;
    },
    salt: async () => randomBytes(4),
    hasPublicKey: async () => true,
  };

  const market: Market = {
    async snapshot() {
      for (const symbol of Object.keys(world.spot) as Underlying[]) world.spot[symbol] *= 1 + (Math.random() - 0.5) * 0.0008;
      return { spot: { ...world.spot } };
    },
    history: async (underlying) => world.history[underlying as Underlying],
  };

  const steps: DepositStatus[] = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"];
  const oneClick: OneClick = {
    assets: async () => [
      { assetId: "nep141:base-usdc", symbol: "USDC", blockchain: "base", decimals: 6 },
      { assetId: "nep141:arb-usdc", symbol: "USDC", blockchain: "arb", decimals: 6 },
      { assetId: "nep141:sol-usdc", symbol: "USDC", blockchain: "sol", decimals: 6 },
      { assetId: "nep141:eth-usdt", symbol: "USDT", blockchain: "eth", decimals: 6 },
    ],
    async quote(asset, amount, recipient) {
      await sleep(600);
      const depositAddress = asset.blockchain === "sol" ? base58.encode(randomBytes(32)) : `0x${Array.from(randomBytes(20), (b) => b.toString(16).padStart(2, "0")).join("")}`;
      const amountOut = (amount * 9_990n) / 10_000n;
      deposits.set(depositAddress, { startedAt: Date.now(), amount: amountOut, account: recipient, credited: false });
      return { depositAddress, amountIn: amount.toString(), amountOut: amountOut.toString(), timeEstimate: 35 };
    },
    async status(depositAddress) {
      const deposit = deposits.get(depositAddress);
      if (!deposit) return "FAILED";
      const step = steps[Math.min(Math.floor((Date.now() - deposit.startedAt) / DEPOSIT_STEP_MS), steps.length - 1)] ?? "FAILED";
      if (step === "SUCCESS" && !deposit.credited) {
        deposit.credited = true;
        move(deposit.account, config.quoteAsset, deposit.amount);
      }
      return step;
    },
  };

  return { relay, chain, market, oneClick: config.network === "mainnet" ? oneClick : null };
}
