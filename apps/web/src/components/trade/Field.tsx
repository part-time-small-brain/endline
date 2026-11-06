import type { ReactNode } from "react";
import { LABEL } from "../label.ts";

export function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className={`mb-2 ${LABEL}`}>{title}</h3>
      {children}
    </section>
  );
}
