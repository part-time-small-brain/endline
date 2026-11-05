import { m } from "motion/react";
import type { ReactNode } from "react";
import { EASE_DRAWER } from "./motion.ts";

interface Props {
  children: ReactNode;
  className?: string;
  delay?: number;
}

export function Reveal({ children, className, delay = 0 }: Props) {
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y: 32, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.9, ease: EASE_DRAWER, delay }}
    >
      {children}
    </m.div>
  );
}
