import { useEffect, useState } from "react";
import { useApp } from "../../app/context.ts";
import { useData } from "../../app/data.tsx";
import type { DepositAsset, DepositStatus, OneClick } from "../../api/oneClick.ts";
import { depositMenu } from "../../lib/depositMenu.ts";
import { formatUsd, parseUnits, toNumber, toUnits } from "../../lib/money.ts";
import { PENDING_DEPOSIT_KEY, type PendingDeposit, readPendingDeposit } from "../../lib/pendingDeposit.ts";
import { Button } from "../Button.tsx";
import { Chips } from "../Chips.tsx";
import { ChainLabel, TokenLabel } from "./AssetLabel.tsx";
import { DepositAddress } from "./DepositAddress.tsx";

const POLL_MS = 5_000;
const FINAL: DepositStatus[] = ["SUCCESS", "REFUNDED", "FAILED"];

function restore(accountId: string): PendingDeposit | undefined {
  try {
    return readPendingDeposit(localStorage.getItem(PENDING_DEPOSIT_KEY), accountId, Date.now());
  } catch {
    return undefined;
  }
}

function remember(pending: PendingDeposit | undefined) {
  try {
    if (pending) localStorage.setItem(PENDING_DEPOSIT_KEY, JSON.stringify(pending));
    else localStorage.removeItem(PENDING_DEPOSIT_KEY);
  } catch {}
}

export function OneClickDeposit({ oneClick, accountId }: { oneClick: OneClick; accountId: string }) {
  const { config } = useApp();
  const { reload, quoteDecimals } = useData();
  const [assets, setAssets] = useState<DepositAsset[]>();
  const [symbol, setSymbol] = useState<string>();
  const [assetId, setAssetId] = useState<string>();
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(() => restore(accountId));
  const [status, setStatus] = useState<DepositStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const final = status !== undefined && FINAL.includes(status);

  useEffect(() => {
    oneClick.assets().then(setAssets, (e: unknown) => setError(e instanceof Error ? e.message : "Deposits unavailable"));
  }, [oneClick]);

  useEffect(() => {
    if (!pending || final) return;
    let alive = true;
    const check = () => oneClick.status(pending.depositAddress).then((next) => alive && setStatus(next), () => {});
    check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [oneClick, pending, final]);

  useEffect(() => {
    if (!final) return;
    remember(undefined);
    if (status === "SUCCESS") reload();
  }, [final, status, reload]);

  const menu = assets && depositMenu(assets);
  const token = menu?.find((t) => t.symbol === symbol) ?? menu?.[0];
  const asset = token?.networks.find((a) => a.assetId === assetId) ?? token?.networks[0];
  const units = asset ? parseUnits(amount, asset.decimals) : null;
  const usd = asset && units ? formatUsd(toUnits(toNumber(units, asset.decimals) * asset.price, 2), 2) : undefined;

  const start = async () => {
    if (!asset || !units) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = { ...(await oneClick.quote(asset, units, accountId, config.quoteAsset)), accountId, asset };
      remember(next);
      setStatus(undefined);
      setPending(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create a deposit address");
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    remember(undefined);
    setPending(undefined);
    setStatus(undefined);
  };

  if (pending) return <DepositAddress deposit={pending} status={status} quoteDecimals={quoteDecimals} onBack={back} />;

  return (
    <div className="space-y-4">
      {!menu && !error && <p className="text-sm text-ink-2">Loading assets…</p>}
      {menu && token && (
        <>
          <section className="space-y-2">
            <h3 className="text-xs text-ink-2">You send</h3>
            <Chips
              label="You send"
              columns="flex overflow-x-auto *:shrink-0"
              value={token.symbol}
              onChange={setSymbol}
              options={menu.map((t) => ({ value: t.symbol, label: <TokenLabel symbol={t.symbol} /> }))}
            />
          </section>
          <section className="space-y-2">
            <h3 className="text-xs text-ink-2">Network</h3>
            <Chips
              label="Network"
              columns={token.networks.length > 1 ? "grid grid-cols-2" : "grid"}
              value={asset?.assetId}
              onChange={setAssetId}
              options={token.networks.map((a) => ({ value: a.assetId, label: <ChainLabel code={a.blockchain} /> }))}
            />
          </section>
        </>
      )}
      <div className="space-y-1.5">
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
        {usd && <p className="text-sm text-ink-2">≈ {usd}</p>}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="sticky bottom-0 bg-surface pt-2">
        <Button size="lg" disabled={!units || busy} onClick={() => void start()}>
          {busy ? "Creating address…" : "Get deposit address"}
        </Button>
      </div>
    </div>
  );
}
