import type { OptionKind } from "@endline/sdk";

export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size * 1.2} height={size} viewBox="0 0 48 40" fill="none" strokeWidth={3} strokeLinecap="square" aria-hidden="true" className="shrink-0">
      <path d="M3 11V3h8M37 3h8v8M45 29v8h-8M11 37H3v-8" stroke="currentColor" />
      <path d="M10 20h14" stroke="var(--up)" strokeWidth={4} />
      <path d="M24 20h14" stroke="var(--down)" strokeWidth={4} />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 font-display text-xl font-semibold tracking-[-0.02em]">
      <Mark size={20} />
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
