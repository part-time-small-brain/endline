import type { PricePoint } from "../../api/market.ts";

interface Props {
  history: PricePoint[];
  spot: number;
  nowMs: number;
  rows: number;
  rowAt: (price: number) => number;
}

export function PriceLine({ history, spot, nowMs, rows, rowAt }: Props) {
  const points: PricePoint[] = [...history.filter(([at]) => at < nowMs), [nowMs, spot]];
  const start = points[0]?.[0] ?? nowMs;
  const x = (at: number) => (nowMs > start ? ((at - start) / (nowMs - start)) * 100 : 100);
  const y = (price: number) => ((rowAt(price) + 0.5) / rows) * 100;
  const path = points.map(([at, price], i) => `${i === 0 ? "M" : "L"}${x(at).toFixed(2)},${y(price).toFixed(2)}`).join("");
  return (
    <div className="relative size-full" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <path d={path} fill="none" className="stroke-ink" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="absolute right-0 size-2.5 translate-x-1/2 -translate-y-1/2 rounded-full bg-teal shadow-[0_0_10px_var(--teal)] transition-[top] duration-700 ease-out" style={{ top: `${y(spot)}%` }}>
        <span className="absolute inset-0 rounded-full border-[1.5px] border-teal [animation:pulse-ring_2s_var(--ease-out)_infinite]" />
      </span>
    </div>
  );
}
