import type { OptionKind } from "@endline/sdk";

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path d="M5 12a7 7 0 0 1 14 0z" fill="var(--up)" />
      <path d="M5 12a7 7 0 0 0 14 0z" fill="var(--down)" />
      <rect x="1" y="11" width="22" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-0.5 font-display text-xl font-semibold tracking-[-0.02em]">
      <span className="mx-0.5">
        <Mark />
      </span>
      endline
    </span>
  );
}

const PATHS: Record<OptionKind, string> = {
  call: "M2 19.5h20M12 15V4M7 9l5-5 5 5",
  put: "M2 4.5h20M12 9v11M7 15l5 5 5-5",
};

export function SideGlyph({ kind, size = 24 }: { kind: OptionKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d={PATHS[kind]} />
    </svg>
  );
}
