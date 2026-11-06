import { Check, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { PositionView } from "../app/usePositions.ts";
import { useCollect } from "../hooks/useCollect.ts";
import { formatUsd } from "../lib/money.ts";
import { Button } from "./Button.tsx";

const CONFIRMATION_MS = 8_000;

export function CollectBanner({ views, quoteDecimals }: { views: PositionView[]; quoteDecimals: number }) {
  const collect = useCollect();
  const [collecting, setCollecting] = useState<bigint>();
  const collected = collect.done ? collecting : undefined;

  useEffect(() => {
    if (collected === undefined) return;
    const timer = setTimeout(() => setCollecting(undefined), CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [collected]);

  if (collected !== undefined)
    return (
      <div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-2xl bg-up-soft py-2 pr-2 pl-4 lg:mx-6" role="status">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <Check size={16} weight="bold" aria-hidden="true" />
          <span>
            <b className="font-semibold">Collected</b> {formatUsd(collected, quoteDecimals)}
          </span>
        </p>
        <button type="button" aria-label="Dismiss" onClick={() => setCollecting(undefined)} className="grid size-10 shrink-0 place-items-center rounded-xl hover:bg-ink/5">
          <X size={16} weight="bold" aria-hidden="true" />
        </button>
      </div>
    );

  const ready = views.filter((v) => v.status === "collect");
  if (ready.length === 0) return null;
  const total = ready.reduce((sum, v) => sum + v.payout, 0n);
  return (
    <div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-2xl bg-up-soft py-2 pr-2 pl-4 lg:mx-6" role="status">
      <p className="min-w-0 text-sm">
        <b className="font-semibold">{formatUsd(total, quoteDecimals)}</b> ready to collect
        {collect.error && <span className="block text-xs text-danger">{collect.error}</span>}
      </p>
      <Button
        tone="up"
        className="shrink-0"
        disabled={collect.busy}
        onClick={() => {
          setCollecting(total);
          void collect.collect(ready);
        }}
      >
        {collect.busy ? "Confirm in wallet…" : "Collect"}
      </Button>
    </div>
  );
}
