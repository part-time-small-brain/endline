import type { ReactNode } from "react";

export function Notice({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="rounded-3xl bg-surface p-8 text-center" role="status">
      <p className="font-display text-xl font-semibold">{title}</p>
      <p className="mt-1 text-sm text-ink-2">{body}</p>
      {children}
    </div>
  );
}
