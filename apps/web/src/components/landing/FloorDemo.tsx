import { longPayout, type OptionKind, type Series } from "@endline/sdk";
import { CaretUpDown } from "@phosphor-icons/react";
import { m, useInView, useReducedMotion } from "motion/react";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { linear, ticks } from "../../lib/chart.ts";
import { formatPrice, formatUsd, toNumber, toUnits } from "../../lib/money.ts";
import { amountChoices, maxBinds, ticket } from "../../lib/ticket.ts";
import { SideGlyph } from "../Glyphs.tsx";
import { GlowRect } from "../GlowRect.tsx";
import { LABEL } from "../label.ts";
import { Money } from "../Money.tsx";
import { SPRING } from "./motion.ts";
import { Reveal } from "./Reveal.tsx";
import { SectionHead } from "./SectionHead.tsx";
import { balancedOf, type DemoAsset } from "./useDemoMarket.ts";
import { useSize } from "./useSize.ts";

interface Props {
  asset: DemoAsset;
  quoteDecimals: number;
}

const DEFAULT_PAY_USD = 25n;
const MAX = "max";
const BARS = 46;
const RANGE = 0.08;
const TOP = 44;
const BOTTOM = 24;
const PX_PER_USD = 2.1;
const KEY_STEPS = 5;
const KEYS: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };
const SWEEP_MS = 7_000;
const TICK_MS = 80;

function sweptEnd(series: Series, qd: number, phase: number): number {
  const strike = toNumber(BigInt(series.strike), qd);
  const width = toNumber(BigInt(series.width), qd);
  const toward = series.kind === "call" ? 1 : -1;
  return strike + toward * width * (0.25 + 1.25 * Math.sin(phase * 2 * Math.PI));
}

export function FloorDemo({ asset, quoteDecimals: qd }: Props) {
  const step = 10 ** Math.max(Math.floor(Math.log10(asset.spot)) - 2, 0);
  const snap = (price: number) => Math.round(price / step) * step;
  const low = snap(asset.spot * (1 - RANGE));
  const high = snap(asset.spot * (1 + RANGE));
  const clampEnd = (value: number) => snap(Math.min(Math.max(value, low + step), high - step));
  const balanced = (k: OptionKind) => balancedOf(asset, k, qd);
  const [kind, setKind] = useState<OptionKind>("call");
  const [pay, setPay] = useState<string>();
  const [playing, setPlaying] = useState(true);
  const [end, setEnd] = useState(() => {
    const first = balanced("call");
    return clampEnd(first ? sweptEnd(first, qd, 0) : asset.spot);
  });
  const [plot, { width, height }] = useSize<HTMLDivElement>();
  const dragging = useRef(false);
  const started = useRef(performance.now());
  const reduce = useReducedMotion();
  const inView = useInView(plot);
  const series = balanced(kind);

  useEffect(() => {
    if (!playing || !series) return;
    const moving = !reduce && inView;
    const tick = () => setEnd(clampEnd(sweptEnd(series, qd, moving ? (performance.now() - started.current) / SWEEP_MS : 0)));
    tick();
    if (!moving) return;
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [playing, reduce, inView, series?.id, low, high, qd]);

  if (!series) return null;

  const up = kind === "call";
  const strike = toNumber(BigInt(series.strike), qd);
  const unit = 10n ** BigInt(qd);
  const mark = asset.marks[series.id];
  const max = ticket(series, unit, mark).maxCost;
  const capped = maxBinds(max, unit);
  const budget = pay === MAX ? max : pay ? BigInt(pay) : capped && max < DEFAULT_PAY_USD * unit ? max : DEFAULT_PAY_USD * unit;
  const bought = ticket(series, budget, mark);
  const payOptions = [
    ...amountChoices(max, unit, budget).map((amount) => ({ value: String(amount), label: formatUsd(amount, qd).replace(/\.00$/, "") })),
    ...(capped ? [{ value: MAX, label: "Max" }] : []),
  ];
  const paid = toNumber(bought.cost, qd);
  const payout = (price: number) => longPayout(bought.terms, bought.size, toUnits(price, qd));
  const y = linear([low, high], [height - BOTTOM, TOP]);
  const axis = width < 500 ? 64 : 88;
  const x0 = axis + (width - axis) * 0.46;
  const room = width - x0 - 24;
  const scale = Math.min(PX_PER_USD, (x0 - axis - 24) / paid);
  const floorX = x0 - paid * scale;
  const yK = y(strike);
  const pitch = (height - TOP - BOTTOM) / BARS;
  const hot = Math.min(Math.max(Math.floor(((end - low) / (high - low)) * BARS), 0), BARS - 1);
  const bars = Array.from({ length: BARS }, (_, i) => {
    const price = low + ((high - low) * (i + 0.5)) / BARS;
    const result = toNumber(payout(price), qd) - paid;
    return { price, result, length: Math.max(Math.min(result * scale, room), -paid * scale) };
  });
  const won = payout(end);
  const result = won - bought.cost;
  const price = (value: number) => formatPrice(toUnits(value, qd), qd);

  const dragTo = (event: PointerEvent) => {
    const top = plot.current?.getBoundingClientRect().top ?? 0;
    setPlaying(false);
    setEnd(clampEnd(y.invert(event.clientY - top)));
  };
  const key = (event: KeyboardEvent) => {
    const direction = KEYS[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    setPlaying(false);
    setEnd(clampEnd(end + direction * step * KEY_STEPS));
  };

  return (
    <section id="floor" data-side={up ? "up" : "down"} className="border-y border-rule py-24 lg:py-36">
      <div className="mx-auto max-w-7xl px-4 lg:px-12">
        <SectionHead title="No liquidations. Ever.">Drag where {asset.symbol} ends.</SectionHead>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[400px_minmax(0,1fr)] lg:gap-12">
          <Reveal className="flex flex-col gap-6">
            <Segmented label="Your side" value={kind} onChange={setKind} options={(["call", "put"] as const).map((k) => {
              const s = balanced(k);
              return {
                value: k,
                label: (
                  <>
                    <SideGlyph kind={k} size={18} />
                    {k === "call" ? "Up above" : "Down below"} {s ? formatPrice(BigInt(s.strike), qd) : ""}
                  </>
                ),
              };
            })} />
            <Segmented label="You pay" value={capped && budget >= max ? MAX : String(budget)} onChange={setPay} options={payOptions} />
            <div aria-live="polite" className={`flex flex-col gap-2 rounded-md border p-6 transition-colors duration-300 ${won > 0n ? "border-side bg-side-field" : "border-rule bg-surface"}`}>
              <p className="font-mono text-[0.6875rem] tracking-[0.08em] text-ink-3 uppercase">
                {asset.symbol} ends at {price(end)}
              </p>
              <p className="font-display text-4xl font-semibold tracking-[-0.02em] lg:text-5xl">
                You get <Money value={won} decimals={qd} />
              </p>
              <p className="text-lg font-semibold">
                Result {result > 0n ? "+" : ""}
                {formatUsd(result, qd).replace("-", "−")}
              </p>
            </div>
            <p className="text-sm text-ink-2">Only the final price counts, so a dip before the end can't liquidate you.</p>
          </Reveal>

          <Reveal>
            <div
              ref={plot}
              role="slider"
              tabIndex={0}
              aria-label={`Where ${asset.symbol} ends`}
              aria-orientation="vertical"
              aria-valuemin={low}
              aria-valuemax={high}
              aria-valuenow={end}
              aria-valuetext={price(end)}
              onKeyDown={key}
              onPointerDown={(event) => {
                plot.current?.setPointerCapture(event.pointerId);
                dragging.current = true;
                dragTo(event);
              }}
              onPointerMove={(event) => dragging.current && dragTo(event)}
              onPointerUp={() => (dragging.current = false)}
              onPointerCancel={() => (dragging.current = false)}
              className="relative h-[440px] cursor-ns-resize touch-none overflow-hidden rounded-md border border-rule bg-surface select-none lg:h-[560px]"
            >
              {width > 0 && (
                <>
                  <svg width={width} height={height} className="absolute inset-0" aria-hidden="true">
                    <GlowRect side="up" picked={up} width={width} height={yK} />
                    <GlowRect side="down" picked={!up} y={yK} width={width} height={Math.max(height - yK, 0)} />
                    {ticks([low, high], 8)
                      .filter((t) => Math.abs(y(t) - yK) > 12 && Math.abs(y(t) - (up ? yK - 14 : yK + 18)) > 16)
                      .map((t) => (
                        <text key={t} x={16} y={y(t) + 4} className="fill-ink-2 font-mono text-xs">
                          {price(t)}
                        </text>
                      ))}
                    {bars.map((bar, i) => (
                      <m.rect
                        key={i}
                        x={x0}
                        y={y(bar.price) - pitch * 0.31}
                        width={1}
                        height={pitch * 0.62}
                        className={i === hot ? "fill-ink" : bar.result >= 0 ? "fill-side" : "fill-ink/20"}
                        style={{ originX: 0 }}
                        initial={false}
                        animate={{ scaleX: bar.length }}
                        transition={SPRING}
                      />
                    ))}
                    <line x1={x0} x2={x0} y1={TOP - 8} y2={height - BOTTOM + 8} className="stroke-ink" strokeWidth="1.5" />
                    <m.g initial={false} animate={{ x: floorX - 3 }} transition={SPRING}>
                      <line x1={0} x2={0} y1={TOP - 8} y2={height - BOTTOM + 8} className="stroke-ink" strokeWidth="3" strokeLinecap="round" />
                      <text x={-8} y={up ? height - 32 : TOP + 8} textAnchor="end" className="fill-ink text-sm font-semibold">
                        Floor −{formatUsd(bought.cost, qd, "up").replace(/\.00$/, "")}
                      </text>
                    </m.g>
                    <line x1={0} x2={width} y1={yK} y2={yK} className="stroke-ink" strokeWidth="2.5" />
                    <text x={16} y={up ? yK - 10 : yK + 22} className="fill-ink text-sm font-semibold">
                      {width < 500 ? "To beat" : "Price to beat"} {price(strike)}
                    </text>
                    <line x1={axis - 8} x2={width} y1={y(end)} y2={y(end)} className="stroke-ink" strokeWidth="1.5" strokeDasharray="4 4" />
                  </svg>
                  <span
                    className="pointer-events-none absolute right-4 inline-flex h-8 items-center gap-1 rounded-full bg-ink px-3 text-[13px] font-semibold text-on-ink"
                    style={{ top: y(end) - 16 }}
                  >
                    <CaretUpDown size={14} weight="bold" aria-hidden="true" />
                    {asset.symbol} ends at {price(end)}
                  </span>
                </>
              )}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

interface SegmentedProps<T> {
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
}

function Segmented<T extends string | number>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div>
      <p className={`mb-2 ${LABEL}`}>{label}</p>
      <div role="radiogroup" aria-label={label} className="flex rounded-xl ring-1 ring-ink/20 ring-inset">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-h-11 min-w-0 flex-1 flex-wrap items-center justify-center gap-2 rounded-xl px-2 py-2 text-sm font-semibold whitespace-normal transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] ${
              option.value === value ? "bg-ink text-on-ink" : "text-ink-2 hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
