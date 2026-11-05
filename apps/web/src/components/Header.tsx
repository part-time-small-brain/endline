import { ChartLine, Plus, SignOut, Stack } from "@phosphor-icons/react";
import { useApp } from "../app/context.ts";
import { useData } from "../app/data.tsx";
import { Link } from "../app/router.tsx";
import { setTradeMode, useTradeMode } from "../hooks/useTradeMode.ts";
import type { TradeMode } from "../lib/tradeMode.ts";
import { PATHS, type Route } from "../lib/route.ts";
import { useWallet } from "../wallet/context.tsx";
import { Button } from "./Button.tsx";
import { Mark, Wordmark } from "./Glyphs.tsx";
import { Money } from "./Money.tsx";
import { Popover } from "./Popover.tsx";

interface Props {
  route: Route;
  open: number;
  toCollect: number;
  onConnect: () => void;
  onAddFunds: () => void;
}

const VIEWS = { lite: "Lite", pro: "Pro", tap: "Tap" } as const;
const short = (account: string) => (account.length > 16 ? `${account.slice(0, 6)}…${account.slice(-4)}` : account);

export function Header({ route, open, toCollect, onConnect, onAddFunds }: Props) {
  const { config } = useApp();
  const mode = useTradeMode();
  const { wallet, disconnect } = useWallet();
  const { balance, quoteDecimals } = useData();
  const money = balance === undefined ? "…" : <Money value={balance} decimals={quoteDecimals} />;
  const tag = config.mock ? "Demo" : config.network === "testnet" ? "Testnet" : undefined;
  const badge =
    toCollect > 0 ? (
      <>
        <span className="absolute top-1 right-1 size-2 rounded-full bg-up" aria-hidden="true" />
        <span className="sr-only">{toCollect} to collect</span>
      </>
    ) : open > 0 ? (
      <span className="sr-only xl:not-sr-only">
        <span className="rounded-md bg-ink px-1.5 py-0.5 text-xs text-on-ink">{open} open</span>
      </span>
    ) : null;
  const tabs = [
    { href: PATHS.trade, label: "Trade", Icon: ChartLine, current: route === "trade" },
    { href: PATHS.positions, label: "Positions", Icon: Stack, current: route === "positions" },
  ];

  const navigation = (
    <>
      <nav aria-label="App" className="flex shrink-0 rounded-xl bg-track near:bg-transparent min-[360px]:near:gap-2">
        {tabs.map(({ href, label, Icon, current }) => (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`relative inline-flex h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold transition-colors duration-150 sm:px-3.5 near:rounded-none near:border-y-2 near:border-t-transparent near:px-1 near:font-mono near:text-xs near:tracking-[0.06em] near:uppercase ${current ? "bg-paper text-ink near:border-b-up near:bg-transparent" : "text-ink-2 hover:text-ink near:border-b-transparent"}`}
          >
            <Icon size={18} aria-hidden="true" className="hidden sm:block" />
            <span className="sm:sr-only lg:not-sr-only">{label}</span>
            {href === PATHS.positions && badge}
          </Link>
        ))}
      </nav>
      {route === "trade" && (
        <div aria-label="Trade view" role="group" className="flex shrink-0 grow rounded-xl bg-track sm:grow-0 near:bg-transparent near:ring-1 near:ring-ink/20 near:ring-inset">
          {(Object.keys(VIEWS) as TradeMode[]).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={mode === view}
              onClick={() => setTradeMode(view)}
              className={`h-11 min-w-11 grow rounded-xl px-2 text-sm font-semibold transition-colors min-[360px]:px-3 sm:px-4 near:font-mono near:text-[11px] near:tracking-[0.06em] near:uppercase ${mode === view ? "bg-ink text-on-ink" : "text-ink-2 hover:text-ink"}`}
            >
              {VIEWS[view]}
            </button>
          ))}
        </div>
      )}
    </>
  );

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-1.5 sm:min-h-16 sm:px-6 sm:py-0 near:border-b near:border-rule">
      <div className="flex shrink-0 items-center gap-3">
        <Link href={PATHS.landing} aria-label="near·options home" className="-m-2 rounded-lg p-2 sm:m-0 sm:p-0">
          <span className="hidden sm:inline">
            <Wordmark />
          </span>
          <span className="sm:hidden">
            <Mark size={28} />
          </span>
        </Link>
        <div className="hidden sm:contents">{navigation}</div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        {tag && (
          <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-ink px-2 text-xs font-semibold text-on-ink near:border near:border-ink/20 near:bg-transparent near:font-mono near:text-[10px] near:font-medium near:tracking-[0.12em] near:text-ink-2 near:uppercase">
            <span className="size-1.5 rounded-full bg-up" aria-hidden="true" />
            {tag}
          </span>
        )}
        {wallet ? (
          <>
            <button type="button" onClick={onAddFunds} className="h-11 rounded-xl bg-surface px-3 font-semibold xl:hidden near:border near:border-ink/20 near:font-mono near:text-[13px] near:font-medium" aria-label="Balance, add funds">
              {money}
            </button>
            <div className="hidden h-12 items-center gap-3 rounded-xl bg-surface py-1 pr-1 pl-4 xl:flex">
              <span className="text-sm text-ink-2">Balance</span>
              <span className="font-semibold">{money}</span>
              <Button onClick={onAddFunds}>
                <Plus size={16} weight="bold" aria-hidden="true" />
                Add funds
              </Button>
            </div>
            <Popover
              label={`Account ${wallet.accountId}`}
              button={
                <>
                  <span className="grid size-11 place-items-center rounded-[10px] bg-ink text-on-ink xl:size-10">
                    <Mark size={22} />
                  </span>
                  <span className="hidden xl:inline">{short(wallet.accountId)}</span>
                </>
              }
              buttonClassName="flex h-11 items-center gap-2 rounded-xl text-sm font-semibold transition-colors duration-150 xl:h-12 xl:bg-surface xl:py-1 xl:pr-4 xl:pl-1 xl:hover:bg-paper"
              panelClassName="w-64 rounded-2xl bg-surface p-2 shadow-[0_12px_32px_rgb(0_0_0/0.18)]"
            >
              <span className="block px-2 py-2 text-sm font-semibold break-all">{wallet.accountId}</span>
              <Button tone="ghost" className="w-full" onClick={() => void disconnect()}>
                <SignOut size={16} weight="bold" aria-hidden="true" />
                Disconnect
              </Button>
            </Popover>
          </>
        ) : (
          <Button className="min-h-11" onClick={onConnect}>Connect</Button>
        )}
      </div>
      <div className="flex w-full items-center gap-2 sm:hidden">{navigation}</div>
    </header>
  );
}
