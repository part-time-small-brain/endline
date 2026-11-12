import { useEffect, useRef, useState } from "react";
import { useApp } from "../../app/context.ts";
import { useData } from "../../app/data.tsx";
import { type DepositAsset, type DepositStatus, MAX_DEPOSIT_UNITS, type OneClick } from "../../api/oneClick.ts";
import { useNow } from "../../hooks/useNow.ts";
import { depositMenu } from "../../lib/depositMenu.ts";
import { formatUsd, parseUnits, toNumber, toUnits } from "../../lib/money.ts";
import { depositStage, keepsDeposit, type PendingDeposit, pendingDepositKey, readPendingDeposit } from "../../lib/pendingDeposit.ts";
import { Button } from "../Button.tsx";
import { Chips } from "../Chips.tsx";
import { ChainLabel, TokenLabel } from "./AssetLabel.tsx";
import { DepositAddress } from "./DepositAddress.tsx";

const POLL_MS = 5_000;
const NETWORK_PICKED = '[aria-label="Network"] [aria-checked="true"]';

function restore(key: string): PendingDeposit | undefined {
  try {
    const stored = localStorage.getItem(key);
    const pending = stored === null ? undefined : readPendingDeposit(stored);
    if (stored !== null && !pending) localStorage.removeItem(key);
    return pending;
  } catch {
    return undefined;
  }
}

function save(key: string, pending: PendingDeposit, replace = false) {
  try {
    const saved = readPendingDeposit(localStorage.getItem(key) ?? "");
    if (replace || !saved || saved.depositAddress === pending.depositAddress) localStorage.setItem(key, JSON.stringify(pending));
  } catch {}
}

function forget(key: string, depositAddress: string) {
  try {
    if (readPendingDeposit(localStorage.getItem(key) ?? "")?.depositAddress === depositAddress) localStorage.removeItem(key);
  } catch {}
}

export function OneClickDeposit({ oneClick, accountId }: { oneClick: OneClick; accountId: string }) {
  const { config } = useApp();
  const { reload, quoteDecimals } = useData();
  const [assets, setAssets] = useState<DepositAsset[]>();
  const [symbol, setSymbol] = useState<string>();
  const [assetId, setAssetId] = useState<string>();
  const [amount, setAmount] = useState("");
  const key = pendingDepositKey(accountId);
  const [pending, setPending] = useState(() => restore(key));
  const [status, setStatus] = useState<DepositStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const now = useNow(1_000);
  const stage = pending && depositStage(status, pending, now);
  const done = stage === "done";
  const root = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  useEffect(() => {
    oneClick.assets().then(setAssets, (e: unknown) => setError(e instanceof Error ? e.message : "Deposits unavailable"));
  }, [oneClick]);

  useEffect(() => {
    if (!pending || done) return;
    let alive = true;
    const check = () => oneClick.status(pending.depositAddress).then((next) => alive && setStatus(next), () => {});
    check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [oneClick, pending, done]);

  useEffect(() => {
    if (!pending || !stage) return;
    if (keepsDeposit(stage, status)) return save(key, pending);
    forget(key, pending.depositAddress);
    if (status === "SUCCESS") reload();
  }, [pending, stage, status, key, reload]);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    root.current?.querySelector<HTMLElement>(pending ? "h3" : NETWORK_PICKED)?.focus();
  }, [pending]);

  const menu = assets && depositMenu(assets);
  const token = menu?.find((t) => t.symbol === symbol) ?? menu?.[0];
  const asset = token?.networks.find((a) => a.assetId === assetId) ?? token?.networks[0];
  const parsed = asset ? parseUnits(amount, asset.decimals) : null;
  const tooLarge = parsed !== null && parsed > MAX_DEPOSIT_UNITS;
  const units = tooLarge ? null : parsed;
  const dollars = asset && units ? toNumber(units, asset.decimals) * asset.price : NaN;
  const usd = Number.isFinite(dollars) ? formatUsd(toUnits(dollars, 2), 2) : undefined;

  const start = async () => {
    if (!asset || !units) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = { ...(await oneClick.quote(asset, units, accountId, config.quoteAsset)), asset };
      setStatus(undefined);
      save(key, next, true);
      moveFocus.current = true;
      setPending(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create a deposit address");
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    if (pending) forget(key, pending.depositAddress);
    setStatus(undefined);
    moveFocus.current = true;
    setPending(undefined);
  };

  if (pending && stage)
    return (
      <div ref={root}>
        <DepositAddress deposit={pending} status={status} stage={stage} quoteDecimals={quoteDecimals} onBack={back} />
      </div>
    );

  return (
    <div ref={root} className="space-y-4">
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
        {tooLarge && <p className="text-sm text-danger">That amount is too large.</p>}
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
