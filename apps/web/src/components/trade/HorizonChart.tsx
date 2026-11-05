import type { OptionKind } from "@endline/sdk";
import { ArrowsVertical, CaretUpDown } from "@phosphor-icons/react";
import { m, useReducedMotion, useSpring } from "motion/react";
import { type KeyboardEvent, type PointerEvent, useId, useLayoutEffect, useRef, useState } from "react";
import type { PricePoint } from "../../api/market.ts";
import { barScale, chartDomain, cone, linear, nearestIndex, ticks } from "../../lib/chart.ts";
import { formatPrice, formatUsd, toNumber, toUnits } from "../../lib/money.ts";
import { GlowRect } from "../GlowRect.tsx";

interface Props {
  symbol: string;
  kind: OptionKind;
  history: PricePoint[];
  spot: number;
  vol: number;
  nowSec: number;
  expiry: number;
  strikes: number[];
  strikeIndex: number;
  focus: number[];
  breakeven: number | null;
  quoteDecimals: number;
  payout: (price: number) => bigint;
  reference: (price: number) => bigint;
  onStrike: (index: number) => void;
  onLine?: (y: number) => void;
}

const WIDE = { axis: 80, top: 24, bottom: 32, history: 0.46, future: 0.2, bars: 72, ticks: 7 };
const COMPACT = { axis: 64, top: 16, bottom: 28, history: 0.34, future: 0.22, bars: 52, ticks: 5 };
const COMPACT_BELOW_PX = 640;
const DAY_MS = 86_400_000;
const YEAR_SEC = 365 * 86_400;
const CONE_STEPS = 24;
const BAR_REACH = 0.9;
const SPRING = { type: "spring", duration: 0.4, bounce: 0.12 } as const;
const HINT_KEY = "dragged";
const KEYS: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, PageUp: 1, ArrowDown: -1, ArrowLeft: -1, PageDown: -1 };

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

function draggedBefore(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true;
  }
}

export function HorizonChart(props: Props) {
  const { symbol, kind, history, spot, vol, nowSec, expiry, strikes, strikeIndex, focus, breakeven, quoteDecimals, payout, reference, onStrike, onLine } = props;
  const box = useRef<HTMLDivElement>(null);
  const clip = useId();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragged, setDragged] = useState(false);
  const [pointerY, setPointerY] = useState<number | null>(null);
  const [hint] = useState(() => !draggedBefore());
  const reduce = useReducedMotion();
  const line = useSpring(0, SPRING);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { width, height } = size;
  const layout = width < COMPACT_BELOW_PX ? COMPACT : WIDE;
  const compact = layout === COMPACT;
  const x1 = Math.max(width - layout.axis, 0);
  const xNow = x1 * layout.history;
  const xEnd = xNow + x1 * layout.future;
  const y0 = layout.top;
  const y1 = Math.max(height - layout.bottom, y0 + 1);
  const up = kind === "call";
  const years = Math.max(expiry - nowSec, 0) / YEAR_SEC;
  const strike = strikes[strikeIndex] ?? spot;
  const neighbours = strikes.slice(Math.max(strikeIndex - 1, 0), strikeIndex + 2);
  const domain = chartDomain(spot, vol * Math.sqrt(years), history, [...focus, ...neighbours], strike);
  const y = linear(domain, [y1, y0]);
  const lineY = clamp(y(strike), y0, y1);
  const hover = pointerY !== null && !dragging && pointerY >= y0 && pointerY <= y1 ? y.invert(pointerY) : null;

  useLayoutEffect(() => {
    if (placed.current && !reduce) line.set(lineY);
    else line.jump(lineY);
    placed.current = width > 0;
    if (width > 0) onLine?.(lineY);
  }, [line, lineY, reduce, width, onLine]);

  const nowMs = nowSec * 1000;
  const x = linear([nowMs - DAY_MS, nowMs], [0, xNow]);
  const price = (value: number) => formatPrice(toUnits(value, quoteDecimals), quoteDecimals);
  const usd = (value: bigint) => (value === 0n ? "$0" : formatUsd(value, quoteDecimals));

  const points = [...history.filter(([t]) => t >= nowMs - DAY_MS && t < nowMs).map(([t, p]) => [x(t), y(p)]), [xNow, y(spot)]];
  const linePath = `M${points.map(([px, py]) => `${px?.toFixed(1)},${py?.toFixed(1)}`).join("L")}`;
  const band = cone(spot, vol, years, CONE_STEPS);
  const at = (f: number) => (xNow + (xEnd - xNow) * f).toFixed(1);
  const conePath = `M${band.map((p) => `${at(p.at)},${y(p.high).toFixed(1)}`).join("L")}L${[...band]
    .reverse()
    .map((p) => `${at(p.at)},${y(p.low).toFixed(1)}`)
    .join("L")}Z`;

  const barPrices = Array.from({ length: layout.bars }, (_, i) => domain[0] + ((domain[1] - domain[0]) * i) / (layout.bars - 1));
  const ribbon = Math.max(x1 - xEnd - 12, 0);
  const edge = up ? domain[1] : domain[0];
  const scale = toNumber(barScale(reference(edge), payout(edge)), quoteDecimals) || 1;
  const reach = (p: number) => clamp((toNumber(payout(p), quoteDecimals) / scale) * BAR_REACH, 0, 1);
  const barHeight = clamp(((y1 - y0) / (layout.bars - 1)) * 0.58, 2, 6);
  const hot = hover === null ? -1 : nearestIndex(hover, barPrices);
  const edgeEnd = xEnd + 4 + ribbon * reach(edge);
  const capInside = edgeEnd + 64 > x1;
  const capTop = up ? y0 - 2 : y1 - 22;
  const hintCoversCap = Math.abs(lineY - (capTop + 10)) < 24;
  const yNow = y(spot);
  const nowTagY = Math.abs(yNow - lineY) < 30 ? (yNow < lineY ? lineY - 44 : lineY + 16) : yNow - 11;
  const beY = breakeven === null ? null : y(breakeven);
  const axis = ticks(domain, layout.ticks).filter((t) => y(t) > y0 + 6 && y(t) < y1 - 6);

  const priceAt = (clientY: number) => y.invert(clamp(clientY - (box.current?.getBoundingClientRect().top ?? 0), y0, y1));
  const startDrag = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    box.current?.setPointerCapture(event.pointerId);
    setDragging(true);
    setDragged(true);
    setPointerY(null);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {}
  };
  const inspect = (event: PointerEvent) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    if (dragging) {
      const index = nearestIndex(priceAt(event.clientY), strikes);
      if (index >= 0 && index !== strikeIndex) onStrike(index);
      return;
    }
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    setPointerY(px >= xNow && px <= x1 && py >= y0 && py <= y1 ? py : null);
  };
  const key = (event: KeyboardEvent) => {
    const step = KEYS[event.key];
    const index = event.key === "Home" ? 0 : event.key === "End" ? strikes.length - 1 : step === undefined ? undefined : strikeIndex + step;
    if (index === undefined) return;
    event.preventDefault();
    onStrike(clamp(index, 0, strikes.length - 1));
  };
  const xLabels: [number, string, string][] = [
    [4, "24h ago", "start"],
    [xNow, "Now", "middle"],
    [xEnd, "End", "middle"],
    [xEnd + 4 + ribbon / 2, "Payout", "middle"],
  ];
  if (!compact) xLabels.splice(1, 0, [xNow / 2, "12h ago", "middle"]);

  return (
    <div
      ref={box}
      className={`relative size-full overflow-hidden select-none ${dragging ? "cursor-grabbing" : ""}`}
      onPointerMove={inspect}
      onPointerDown={inspect}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onPointerLeave={(event) => !dragging && event.pointerType === "mouse" && setPointerY(null)}
    >
      {width > 0 && (
        <>
          <svg width={width} height={height} className="absolute inset-0 overflow-visible" role="img" aria-label={`${symbol} over the last 24 hours, the price to beat at ${price(strike)} and what you get at each end price`}>
            <defs>
              <clipPath id={clip}>
                <rect width={x1} height={y1} />
              </clipPath>
            </defs>
            <g clipPath={`url(#${clip})`}>
              <m.g style={{ y: line }}>
                <GlowRect side="up" picked={up} y={-height} width={x1} height={height} />
                <GlowRect side="down" picked={!up} width={x1} height={height} />
                <line x1={xEnd + 1} x2={xEnd + 1} y1={up ? 0 : -height} y2={up ? height : 0} className="stroke-ink" strokeWidth="3" />
              </m.g>
              {axis.map((t) => (
                <line key={t} x1={0} x2={x1} y1={y(t)} y2={y(t)} className="stroke-grid" />
              ))}
              <path d={conePath} className="fill-cone" />
              <line x1={xEnd} x2={xEnd} y1={0} y2={y1} className="stroke-ink/30" strokeDasharray="2 4" />
              <path d={linePath} fill="none" className="stroke-ink" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {barPrices.map((p, i) => (
                <m.rect
                  key={i}
                  x={xEnd + 4}
                  y={y(p) - barHeight / 2}
                  width={ribbon}
                  height={barHeight}
                  rx={2}
                  className={i === hot ? "fill-ink" : "fill-side"}
                  style={{ originX: 0 }}
                  initial={false}
                  animate={{ scaleX: reach(p) }}
                  transition={SPRING}
                />
              ))}
              {beY !== null && (
                <m.line initial={false} animate={{ y: beY }} transition={SPRING} x1={xNow + 4} x2={x1} y1={0} y2={0} className="stroke-ink/60" strokeWidth="1.25" strokeDasharray="1 4" strokeLinecap="round" />
              )}
              {hover !== null && <line x1={xNow} x2={x1} y1={y(hover)} y2={y(hover)} className="stroke-ink/50" strokeDasharray="3 3" />}
            </g>
            <m.line style={{ y: line }} x1={0} x2={x1} y1={0} y2={0} className="stroke-ink" strokeWidth={dragging ? 3 : 2.5} />
            <circle cx={xNow} cy={yNow} r="6" fill="none" className="origin-center stroke-ink [transform-box:fill-box] [animation:pulse-ring_2s_var(--ease-out)_infinite]" strokeWidth="1.5" />
            <circle cx={xNow} cy={yNow} r="5" className="fill-ink stroke-surface" strokeWidth="2" />
            {hover !== null && <circle cx={xEnd + 4 + ribbon * reach(hover)} cy={y(hover)} r="5" className="fill-paper stroke-ink" strokeWidth="2" />}
          </svg>

          {axis
            .filter((t) => Math.abs(y(t) - lineY) > 16)
            .map((t) => (
              <span key={t} className="pointer-events-none absolute text-xs font-medium text-ink-2" style={{ left: x1 + 12, top: y(t) - 8 }}>
                {price(t)}
              </span>
            ))}

          {xLabels.map(([left, text, anchor]) => (
            <span
              key={text}
              className={`pointer-events-none absolute bottom-2.5 text-xs whitespace-nowrap ${text === "Now" ? "font-semibold text-ink" : "font-medium text-ink-2"} ${anchor === "middle" ? "-translate-x-1/2" : ""}`}
              style={{ left }}
            >
              {text}
            </span>
          ))}

          <span
            className="pointer-events-none absolute rounded-md bg-paper px-1.5 text-xs leading-5 font-semibold shadow-[inset_0_0_0_1.25px_var(--ink)]"
            style={{ left: xNow + 8, top: nowTagY }}
          >
            {price(spot)}
          </span>

          <m.span
            initial={false}
            animate={{ x: capInside ? edgeEnd - 8 : edgeEnd + 8, y: capTop }}
            transition={SPRING}
            className={`pointer-events-none absolute top-0 left-0 text-sm font-semibold whitespace-nowrap ${capInside ? "-translate-x-full rounded-md bg-paper px-1.5" : ""}`}
          >
            {usd(payout(edge))}
          </m.span>

          <m.div style={{ y: line }} className="absolute inset-x-0 top-0">
            <span className={`pointer-events-none absolute text-[13px] font-semibold text-ink-2 ${up ? "top-3" : "-top-8"}`} style={{ left: xEnd + 12 }}>
              $0
            </span>
            {hint && (
              <span
                className={`pointer-events-none absolute inline-flex h-7 items-center gap-1.5 rounded-lg bg-ink px-2.5 text-[13px] font-semibold whitespace-nowrap text-on-ink -top-3.5 transition-opacity duration-500 ${dragged || hintCoversCap ? "opacity-0" : ""}`}
                style={{ right: layout.axis + 4 }}
              >
                <ArrowsVertical size={14} weight="bold" aria-hidden="true" />
                Drag
              </span>
            )}
            <div className={`absolute -top-2.5 h-5 touch-none ${dragging ? "" : "cursor-grab"}`} style={{ left: 0, width: x1 }} onPointerDown={startDrag} aria-hidden="true" />
            <div
              role="slider"
              tabIndex={0}
              aria-label="Price to beat"
              aria-orientation="vertical"
              aria-valuemin={strikes[0]}
              aria-valuemax={strikes.at(-1)}
              aria-valuenow={strike}
              aria-valuetext={price(strike)}
              onPointerDown={startDrag}
              onKeyDown={key}
              className={`absolute -top-3.5 flex h-7 touch-none ${dragging ? "" : "cursor-grab"} items-center justify-center gap-1 rounded-[14px] bg-ink text-[13px] font-semibold text-on-ink transition-transform duration-150 ease-out active:scale-95`}
              style={{ left: x1 + 4, width: layout.axis - 8 }}
            >
              <CaretUpDown size={14} weight="bold" className="opacity-70" aria-hidden="true" />
              {short(strike)}
            </div>
          </m.div>

          {hover !== null && (
            <div
              className="pointer-events-none absolute rounded-[10px] bg-ink px-3 py-1.5 text-sm whitespace-nowrap text-on-ink"
              style={{ right: compact ? undefined : width - xEnd + 12, left: compact ? 8 : undefined, top: clamp(y(hover) - 16, y0, y1 - 32) }}
            >
              <span className="opacity-75">{price(hover)}</span> → <b className="font-semibold">{usd(payout(hover))}</b>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function short(value: number): string {
  if (value < 10_000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${Number((value / 1000).toFixed(1))}k`;
}

