interface Props {
  remainingMs: number;
  totalMs: number;
  frozen: boolean;
}

const R = 20;
const C = 2 * Math.PI * R;

export function Ring({ remainingMs, totalMs, frozen }: Props) {
  const fraction = Math.min(Math.max(remainingMs / Math.max(totalMs, 1), 0), 1);
  const seconds = Math.ceil(Math.max(remainingMs, 0) / 1000);
  const urgent = seconds <= 5;
  return (
    <div className="relative size-14 shrink-0" role="timer" aria-label={frozen ? "Price held while you confirm" : `Price locked for ${seconds} seconds`}>
      <svg viewBox="0 0 48 48" className="size-14 -rotate-90">
        <circle cx="24" cy="24" r={R} fill="none" stroke="var(--rule)" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r={R}
          fill="none"
          stroke={urgent ? "var(--danger)" : "var(--ink)"}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - fraction)}
          className={frozen ? "" : "transition-[stroke-dashoffset] duration-200 ease-linear"}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums">{frozen ? "··" : seconds}</span>
    </div>
  );
}
