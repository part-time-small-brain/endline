import type { ReactNode } from "react";

export function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-[0.625rem] font-medium tracking-[0.14em] text-ink-3 uppercase">{title}</h3>
      {children}
    </section>
  );
}
