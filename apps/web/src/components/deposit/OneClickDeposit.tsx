import { useEffect, useState } from "react";
import { useApp } from "../../app/context.ts";
import { useData } from "../../app/data.tsx";
import type { DepositAsset, DepositQuote, DepositStatus, OneClick } from "../../api/oneClick.ts";
import { formatToken, parseUnits } from "../../lib/money.ts";
import { Button } from "../Button.tsx";
import { Chips } from "../Chips.tsx";
import { CopyField } from "../CopyField.tsx";

const CHAINS: Record<string, string> = { base: "Base", arb: "Arbitrum", eth: "Ethereum", sol: "Solana", btc: "Bitcoin", tron: "Tron", gnosis: "Gnosis", sui: "Sui", aptos: "Aptos" };
const POLL_MS = 5_000;

const STATUS_COPY: Record<DepositStatus, string> = {
  PENDING_DEPOSIT: "Waiting for your transfer",
  KNOWN_DEPOSIT_TX: "Transfer seen",
  PROCESSING: "Converting to USDC",
  SUCCESS: "Ready. Your balance is updated.",
  INCOMPLETE_DEPOSIT: "Less than expected arrived. It will be refunded to your balance.",
  REFUNDED: "Refunded to your NEAR Intents balance.",
  FAILED: "Deposit failed. Any funds are refunded to your NEAR Intents balance.",
};

const chain = (asset: DepositAsset) => CHAINS[asset.blockchain] ?? asset.blockchain.toUpperCase();

export function OneClickDeposit({ oneClick, accountId }: { oneClick: OneClick; accountId: string }) {
  const { config } = useApp();
  const { reload, quoteDecimals } = useData();
  const [assets, setAssets] = useState<DepositAsset[]>();
  const [assetId, setAssetId] = useState<string>();
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<DepositQuote & { asset: DepositAsset }>();
  const [status, setStatus] = useState<DepositStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    oneClick.assets().then(setAssets, (e: unknown) => setError(e instanceof Error ? e.message : "Deposits unavailable"));
  }, [oneClick]);

  useEffect(() => {
    if (!quote || status === "SUCCESS") return;
    const timer = setInterval(() => {
      oneClick.status(quote.depositAddress).then((next) => {
        setStatus(next);
        if (next === "SUCCESS") reload();
      }, () => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [oneClick, quote, status, reload]);

  const asset = assets?.find((a) => a.assetId === assetId) ?? assets?.[0];
  const units = asset ? parseUnits(amount, asset.decimals) : null;

  const start = async () => {
    if (!asset || !units) return;
    setBusy(true);
    setError(undefined);
    try {
      setQuote({ ...(await oneClick.quote(asset, units, accountId, config.quoteAsset)), asset });
      setStatus("PENDING_DEPOSIT");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create a deposit address");
    } finally {
      setBusy(false);
    }
  };

  if (quote)
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          Send exactly{" "}
          <span className="font-semibold text-ink">
            {formatToken(BigInt(quote.amountIn), quote.asset.decimals)} {quote.asset.symbol}
          </span>{" "}
          on {chain(quote.asset)} to this address. About {formatToken(BigInt(quote.amountOut), quoteDecimals, 2)} USDC arrives in about {quote.timeEstimate} s.
        </p>
        <CopyField label="Deposit address" value={quote.depositAddress} />
        <div className="flex items-center gap-3 rounded-2xl bg-well px-4 py-3 text-sm" role="status">
          <span className={`size-2 rounded-full ${status === "SUCCESS" ? "bg-ink" : "animate-pulse bg-ink-3"}`} />
          {status && STATUS_COPY[status]}
        </div>
        <p className="text-xs text-ink-3">If anything goes wrong, funds are refunded to your NEAR Intents balance.</p>
      </div>
    );

  return (
    <div className="space-y-4">
      {!assets && !error && <p className="text-sm text-ink-2">Loading assets…</p>}
      {assets && (
        <Chips
          label="Deposit from"
          columns="grid grid-cols-2"
          value={asset?.assetId}
          onChange={setAssetId}
          options={assets.map((a) => ({ value: a.assetId, label: a.symbol, hint: chain(a) }))}
        />
      )}
      <label className="flex h-12 items-center gap-2 rounded-xl border border-rule bg-well px-4 focus-within:border-ink">
        <input
          inputMode="decimal"
          placeholder="Amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-label="Amount to deposit"
          className="w-full bg-transparent outline-none placeholder:text-ink-3"
        />
        <span className="text-ink-2">{asset?.symbol}</span>
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button size="lg" disabled={!units || busy} onClick={() => void start()}>
        {busy ? "Creating address…" : "Get deposit address"}
      </Button>
    </div>
  );
}
