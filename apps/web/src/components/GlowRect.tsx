import { useId } from "react";

interface Props {
  side: "up" | "down";
  picked: boolean;
  y?: number;
  width: number;
  height: number;
}

export function GlowRect({ side, picked, y = 0, width, height }: Props) {
  const id = useId();
  const color = `var(--${side}-glow${picked ? "" : "-soft"})`;
  const [top, bottom] = side === "up" ? [0, 1] : [1, 0];
  return (
    <>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" className="transition-[stop-color] duration-300" style={{ stopColor: color, stopOpacity: top }} />
        <stop offset="1" className="transition-[stop-color] duration-300" style={{ stopColor: color, stopOpacity: bottom }} />
      </linearGradient>
      <rect y={y} width={width} height={height} fill={`url(#${id})`} />
    </>
  );
}
