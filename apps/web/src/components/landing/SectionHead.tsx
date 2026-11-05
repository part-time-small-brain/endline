import type { ReactNode } from "react";
import { Reveal } from "./Reveal.tsx";

export function SectionHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <Reveal className="mb-10 grid gap-4 lg:mb-16 lg:grid-cols-2 lg:items-end lg:gap-12">
      <h2 className="text-4xl font-semibold lg:text-5xl">{title}</h2>
      {children && <p className="max-w-[520px] text-lg text-current/75">{children}</p>}
    </Reveal>
  );
}
