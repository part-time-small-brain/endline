import NumberFlow from "@number-flow/react";
import { dollarDigits, toRounded } from "../lib/money.ts";

interface Props {
  value: bigint;
  decimals: number;
  rounding?: "down" | "up";
  className?: string;
}

export function Money({ value, decimals, rounding = "down", className }: Props) {
  const digits = dollarDigits(value < 0n ? -value : value, decimals, rounding);
  return (
    <NumberFlow
      value={toRounded(value, decimals, digits, rounding)}
      locales="en-US"
      format={{ style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }}
      className={className}
    />
  );
}
