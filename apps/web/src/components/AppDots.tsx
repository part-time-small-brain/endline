import { useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { useTheme } from "../hooks/useTheme.ts";
import { pull } from "../lib/dots.ts";

const REACH = 160;
const EASE = 0.22;
const DOT = 1.1;
const DOT_ALPHA = 0.9;
const WASH = 3.2 * REACH;
const WASH_ALPHA = 0.2;
const ROW_STRIDE = 4096;

export function AppDots({ up }: { up: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const washRef = useRef<HTMLDivElement>(null);
  const repaint = useRef<() => void>(undefined);
  const theme = useTheme();
  const still = useReducedMotion() === true;

  useEffect(() => {
    const canvas = ref.current;
    const wash = washRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !wash || !ctx) return;
    const gap = Number.parseFloat(getComputedStyle(canvas).getPropertyValue("--dot-gap"));
    const lit = new Map<number, number>();
    let color = "";
    let width = 0;
    let height = 0;
    let cursor: { x: number; y: number } | undefined;
    let shown = 0;
    let frame = 0;

    const wake = () => {
      frame ||= requestAnimationFrame(draw);
    };

    const draw = () => {
      frame = 0;
      const target = new Map<number, number>();
      if (cursor) {
        const x = cursor.x + scrollX;
        const y = cursor.y + scrollY;
        const first = (at: number) => Math.max(0, Math.ceil((at - REACH) / gap - 0.5));
        for (let row = first(y); (row + 0.5) * gap < y + REACH; row++) {
          for (let col = first(x); (col + 0.5) * gap < x + REACH; col++) {
            const { strength } = pull((col + 0.5) * gap - x, (row + 0.5) * gap - y, { x: REACH, y: REACH }, 0);
            if (strength > 0) target.set(row * ROW_STRIDE + col, strength);
          }
        }
      }
      for (const key of target.keys()) if (!lit.has(key)) lit.set(key, 0);

      shown += ((cursor ? 1 : 0) - shown) * EASE;
      let moving = Math.abs((cursor ? 1 : 0) - shown) > 0.005;
      if (cursor) wash.style.transform = `translate(${cursor.x - WASH / 2}px, ${cursor.y - WASH / 2}px)`;
      wash.style.opacity = still ? "0" : String(WASH_ALPHA * shown);

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      for (const [key, was] of lit) {
        const want = target.get(key) ?? 0;
        const now = was + (want - was) * EASE;
        moving ||= Math.abs(want - now) > 0.003;
        if (want === 0 && now < 0.01) {
          lit.delete(key);
          continue;
        }
        lit.set(key, now);
        ctx.globalAlpha = DOT_ALPHA * now;
        ctx.beginPath();
        ctx.arc(((key % ROW_STRIDE) + 0.5) * gap - scrollX, (Math.floor(key / ROW_STRIDE) + 0.5) * gap - scrollY, DOT + now, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (moving) wake();
    };

    const resize = () => {
      const scale = Math.min(devicePixelRatio, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      cancelAnimationFrame(frame);
      draw();
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      cursor = { x: event.clientX, y: event.clientY };
      wake();
    };
    const out = (event: PointerEvent) => {
      if (event.relatedTarget || !cursor) return;
      cursor = undefined;
      wake();
    };
    const scrolled = () => {
      if (cursor || lit.size > 0) wake();
    };
    repaint.current = () => {
      color = getComputedStyle(canvas).getPropertyValue("--side");
      wake();
    };
    repaint.current();

    const size = new ResizeObserver(resize);
    size.observe(canvas);
    addEventListener("pointermove", move);
    addEventListener("scroll", scrolled, { passive: true });
    document.addEventListener("pointerout", out);
    return () => {
      cancelAnimationFrame(frame);
      size.disconnect();
      removeEventListener("pointermove", move);
      removeEventListener("scroll", scrolled);
      document.removeEventListener("pointerout", out);
      repaint.current = undefined;
    };
  }, [still]);

  useEffect(() => repaint.current?.(), [up, theme]);

  const side = up ? "up" : "down";
  return (
    <>
      <div
        ref={washRef}
        data-side={side}
        aria-hidden="true"
        className="pointer-events-none fixed top-0 left-0 -z-10 rounded-full bg-[radial-gradient(closest-side,var(--side-glow),transparent)] opacity-0"
        style={{ width: WASH, height: WASH }}
      />
      <canvas ref={ref} data-side={side} aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 size-full" />
    </>
  );
}
