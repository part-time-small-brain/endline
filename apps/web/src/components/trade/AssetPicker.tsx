import { CurrencyBtc, CurrencyEth } from "@phosphor-icons/react";
import { pickWithArrows } from "../Chips.tsx";

interface Props {
  symbols: string[];
  spot: Record<string, number> | undefined;
  value: string | undefined;
  onChange: (symbol: string) => void;
}

export const ASSET_ICONS: Record<string, typeof CurrencyBtc> = { BTC: CurrencyBtc, ETH: CurrencyEth };
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function AssetPicker({ symbols, spot, value, onChange }: Props) {
  return (
    <div role="radiogroup" aria-label="Asset" className="flex gap-1 rounded-2xl bg-track p-1" onKeyDown={pickWithArrows}>
      {symbols.map((symbol) => {
        const Icon = ASSET_ICONS[symbol];
        const selected = symbol === value;
        return (
          <button
            key={symbol}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(symbol)}
            className={`flex h-12 flex-1 items-center gap-2 rounded-xl py-2 pr-4 pl-2 text-left font-semibold transition-[transform,background-color] duration-150 ease-out active:scale-[0.97] lg:flex-none ${selected ? "bg-paper" : "hover:bg-well"}`}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-on-ink" aria-hidden="true">
              {Icon ? <Icon size={20} weight="bold" /> : symbol.slice(0, 1)}
            </span>
            <span className="leading-[18px]">
              {symbol}
              <small className="block text-xs leading-4 font-medium text-ink-2">{spot?.[symbol] ? usd.format(spot[symbol]) : "…"}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
