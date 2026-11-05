import { bookSummary, type Instrument, indexPrice, type Mark } from "./deribit.ts";
import { markFor, type Point, type Spot, smileOf } from "./surface.ts";

export interface Underlying {
  symbol: string;
  index: string;
  decimals: number;
  minWrite: bigint;
}

export class Market {
  private readonly smiles = new Map<string, Point[]>();
  private readonly spots = new Map<string, Spot>();

  mark(target: Instrument): Mark | undefined {
    return markFor(this.smiles.get(target.underlying) ?? [], this.spots.get(target.underlying), target);
  }

  spot(symbol: string): Spot | undefined {
    return this.spots.get(symbol);
  }

  set(symbol: string, marks: Map<string, Mark>, spot: Spot): void {
    this.smiles.set(symbol, smileOf(marks));
    this.spots.set(symbol, spot);
  }

  async refresh(underlyings: Underlying[]): Promise<void> {
    await Promise.all(
      underlyings.map(async ({ symbol, index }) => {
        const at = Date.now();
        const [marks, price] = await Promise.all([bookSummary(symbol), indexPrice(index)]);
        this.set(symbol, marks, { price, at });
      }),
    );
  }
}
