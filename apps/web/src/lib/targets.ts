import type { OptionKind } from "@near-options/sdk";

export interface Preset {
  name: "Safer" | "Balanced" | "Bolder";
  index: number;
}

export function presets(strikes: bigint[], kind: OptionKind, spot: bigint): Preset[] {
  const last = strikes.length - 1;
  if (last < 0) return [];
  const up = kind === "call";
  const outside = up ? strikes.findIndex((strike) => strike > spot) : strikes.filter((strike) => strike < spot).length - 1;
  const balanced = outside >= 0 ? outside : up ? last : 0;
  const safer = up ? balanced - 1 : balanced + 1;
  const bolder = Math.min(Math.max(up ? balanced + 2 : balanced - 2, 0), last);
  const picks: Preset[] = [
    { name: "Safer", index: safer },
    { name: "Balanced", index: balanced },
    { name: "Bolder", index: bolder },
  ];
  return picks.filter((p) => p.name === "Balanced" || (p.index >= 0 && p.index <= last && p.index !== balanced));
}

