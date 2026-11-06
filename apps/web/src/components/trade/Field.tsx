import type { ReactNode } from "react";

export function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 eyebrow text-ink-3">{title}</h3>
      {children}
    </section>
  );
}
