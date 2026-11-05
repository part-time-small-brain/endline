import type { ButtonHTMLAttributes } from "react";

const TONES = {
  primary: "bg-ink text-on-ink hover:opacity-90",
  up: "bg-up text-on-up hover:brightness-105 near:enabled:shadow-[0_0_32px_var(--up-glow)]",
  down: "bg-down text-on-down hover:brightness-105 near:enabled:shadow-[0_0_32px_var(--down-glow)]",
  ghost: "bg-well text-ink hover:bg-well-hover",
} as const;

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: keyof typeof TONES;
  size?: "md" | "lg";
}

export function Button({ tone = "primary", size = "md", className = "", ...props }: Props) {
  const sizing = size === "lg" ? "h-14 w-full rounded-2xl px-6 text-lg" : "h-10 rounded-xl px-4 text-sm";
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition-[transform,background-color,opacity,filter] duration-150 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${sizing} ${TONES[tone]} ${className}`}
      {...props}
    />
  );
}
