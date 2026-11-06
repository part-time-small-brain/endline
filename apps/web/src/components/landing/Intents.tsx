import { ArrowsIn, GasPump, Wallet } from "@phosphor-icons/react";
import arbitrum from "../../assets/chains/arbitrum.svg";
import base from "../../assets/chains/base.svg";
import bitcoin from "../../assets/chains/bitcoin.svg";
import ethereum from "../../assets/chains/ethereum.svg";
import near from "../../assets/chains/near.svg";
import solana from "../../assets/chains/solana.svg";
import { m, useReducedMotion } from "motion/react";
import { formatPrice } from "../../lib/money.ts";
import { SideGlyph } from "../Glyphs.tsx";
import { Reveal } from "./Reveal.tsx";
import { SectionHead } from "./SectionHead.tsx";
import { useSize } from "./useSize.ts";

interface Props {
  symbol: string;
  strike: bigint;
  quoteDecimals: number;
}

const CHAINS = [
  { name: "Bitcoin", logo: bitcoin },
  { name: "Ethereum", logo: ethereum },
  { name: "Base", logo: base },
  { name: "Arbitrum", logo: arbitrum },
  { name: "Solana", logo: solana },
  { name: "NEAR", logo: near },
];

const FACTS = [
  { Icon: ArrowsIn, title: "Fund from any chain", line: "Deposit from Bitcoin, Ethereum, Solana and more. It arrives as USDC." },
  { Icon: Wallet, title: "One balance in intents.near", line: "Your USDC, options and payouts. We never hold them." },
  { Icon: GasPump, title: "No gas token", line: "Our relay pays the gas for trades and collects." },
];

const WIDE_PX = 640;
const CHAIN_W = 152;
const CHAIN_PITCH = 76;
const CHAIN_TOP = 24;
const HUB_W = 216;
const OUT_W = 184;

export function Intents({ symbol, strike, quoteDecimals }: Props) {
  const [box, { width, height }] = useSize<HTMLDivElement>();
  const reduce = useReducedMotion();
  const wide = width >= WIDE_PX;
  const hubX = width * 0.5 - HUB_W / 2;
  const hubY = height / 2;
  const wires = CHAINS.map((_, i) => {
    const y = CHAIN_TOP + i * CHAIN_PITCH + 24;
    const mid = (CHAIN_W + hubX) / 2;
    return `M${CHAIN_W} ${y} C${mid} ${y} ${mid} ${hubY} ${hubX} ${hubY}`;
  });

  return (
    <section id="intents" className="py-24 lg:py-36">
      <div className="mx-auto max-w-7xl px-4 lg:px-12">
        <SectionHead title="Any chain in. One balance.">Built on NEAR Intents.</SectionHead>
        <div className="grid gap-12 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-center lg:gap-16">
          <ul className="flex flex-col gap-8">
            {FACTS.map(({ Icon, title, line }, i) => (
              <li key={title}>
                <Reveal delay={i * 0.1}>
                  <h3 className="flex items-center gap-3 text-2xl font-semibold">
                    <Icon size={24} aria-hidden="true" />
                    {title}
                  </h3>
                  <p className="mt-2 text-current/75">{line}</p>
                </Reveal>
              </li>
            ))}
          </ul>

          <Reveal>
            <div ref={box} className={`relative ${wide ? "h-[480px]" : "flex flex-col gap-3"}`} aria-hidden="true">
              {wide && (
                <svg width={width} height={height} className="absolute inset-0 overflow-visible">
                  {wires.map((d, i) => (
                    <g key={d}>
                      <path d={d} fill="none" className="stroke-current/35" strokeWidth="1.5" />
                      {!reduce && (
                        <m.path
                          d={d}
                          fill="none"
                          className="stroke-up"
                          strokeWidth="4"
                          strokeLinecap="round"
                          initial={{ pathLength: 0.05, pathOffset: 0 }}
                          animate={{ pathOffset: 1 }}
                          transition={{ duration: 2.4 + i * 0.2, delay: i * 0.35, repeat: Infinity, ease: "linear" }}
                        />
                      )}
                    </g>
                  ))}
                  <line x1={hubX + HUB_W} x2={width - OUT_W} y1={hubY} y2={hubY} className="stroke-current" strokeWidth="2.5" />
                </svg>
              )}
              <ul className={wide ? "contents" : "grid grid-cols-3 gap-2"}>
                {CHAINS.map(({ name, logo }, i) => (
                  <li
                    key={name}
                    className={`flex h-12 items-center gap-2 rounded-xl bg-current/10 p-2 text-sm font-semibold ring-1 ring-current/20 ring-inset ${wide ? "absolute left-0" : ""}`}
                    style={wide ? { top: CHAIN_TOP + i * CHAIN_PITCH, width: CHAIN_W } : undefined}
                  >
                    <img src={logo} alt="" className="size-8 shrink-0" />
                    {name}
                  </li>
                ))}
              </ul>
              <div
                className={`rounded-md border border-rule bg-surface p-4 text-ink ${wide ? "absolute -translate-y-1/2" : ""}`}
                style={wide ? { left: hubX, top: hubY, width: HUB_W } : undefined}
              >
                <p className="font-mono text-[0.625rem] font-medium tracking-[0.14em] text-ink-3 uppercase">One balance</p>
                <p className="font-display text-3xl font-semibold">$412.58</p>
                <p className="font-mono text-xs text-ink-3">USDC</p>
              </div>
              <div className={`rounded-md border border-up bg-up-field p-4 text-up-ink ${wide ? "absolute right-0 -translate-y-1/2" : ""}`} style={wide ? { top: hubY, width: OUT_W } : undefined}>
                <p className="flex items-center gap-2 font-display text-xl font-semibold">
                  <SideGlyph kind="call" size={20} />
                  {symbol} Up
                </p>
                <p className="mt-1 font-mono text-xs text-ink-2">above {formatPrice(strike, quoteDecimals)}</p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
