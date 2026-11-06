import { useData } from "../app/data.tsx";
import type { PositionView } from "../app/usePositions.ts";
import { Button } from "../components/Button.tsx";
import { Notice } from "../components/Notice.tsx";
import { PositionCard } from "../components/PositionCard.tsx";
import type { QuoteSelection } from "../components/QuoteSheet.tsx";
import { useWallet } from "../wallet/context.tsx";

interface Props {
  views: PositionView[] | undefined;
  nowSec: number;
  onConnect: () => void;
  onTrade: () => void;
  onQuote: (selection: QuoteSelection) => void;
}

export function Positions({ views, nowSec, onConnect, onTrade, onQuote }: Props) {
  const { wallet } = useWallet();
  const { quoteDecimals } = useData();

  if (!wallet)
    return (
      <Notice title="No wallet connected" body="Connect one to see your positions.">
        <Button className="mt-5" onClick={onConnect}>
          Connect wallet
        </Button>
      </Notice>
    );
  if (!views) return <Notice title="Loading positions…" body="Reading your NEAR Intents balance." />;
  if (views.length === 0)
    return (
      <Notice title="No positions yet" body="Your trades show up here.">
        <Button className="mt-5" onClick={onTrade}>
          Trade
        </Button>
      </Notice>
    );

  return (
    <div className="space-y-3 pb-10">
      {views.map((view) => (
        <PositionCard key={view.series.id} view={view} quoteDecimals={quoteDecimals} nowSec={nowSec} onSellBack={() => onQuote({ wallet, series: view.series, side: "sell", size: view.held })} />
      ))}
    </div>
  );
}
