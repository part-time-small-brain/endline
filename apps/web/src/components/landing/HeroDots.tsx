import { useEffect, useRef } from "react";
import { NO_PULL, pull } from "../../lib/dots.ts";

const GAP = 18;
const REACH = { x: 270, y: 150 };
const PART = 10;
const EASE = 0.15;
const DOT = 1.1;

interface Dot {
  x: number;
  y: number;
  strength: number;
  lift: number;
  up: boolean;
}

export function HeroDots({ still }: { still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const line = lineRef.current;
    const area = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !line || !area || !ctx) return;
    const part = still ? 0 : PART;
    let width = 0;
    let height = 0;
    let dots: Dot[] = [];
    let cursor: { x: number; y: number } | undefined;
    let shown = 0;
    let frame = 0;

    const style = getComputedStyle(canvas);
    const colors = { grid: style.getPropertyValue("--grid"), up: style.getPropertyValue("--up"), down: style.getPropertyValue("--down") };

    const circle = (dot: Dot, radius: number) => {
      ctx.moveTo(dot.x + radius, dot.y + dot.lift);
      ctx.arc(dot.x, dot.y + dot.lift, radius, 0, 2 * Math.PI);
    };
    const wake = () => {
      frame ||= requestAnimationFrame(draw);
    };

    const draw = () => {
      frame = 0;
      shown += ((cursor ? 1 : 0) - shown) * EASE;
      let moving = Math.abs((cursor ? 1 : 0) - shown) > 0.005;
      if (cursor) line.style.transform = `translate(${cursor.x - REACH.x}px, ${cursor.y - 1}px)`;
      line.style.opacity = still ? "0" : String(0.9 * shown);
      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = colors.grid;
      ctx.beginPath();
      const lit: Dot[] = [];
      for (const dot of dots) {
        const p = cursor ? pull(dot.x - cursor.x, dot.y - cursor.y, REACH, part) : NO_PULL;
        if (p.strength > 0) dot.up = p.up;
        dot.strength += (p.strength - dot.strength) * EASE;
        dot.lift += (p.lift - dot.lift) * EASE;
        moving ||= Math.abs(p.strength - dot.strength) > 0.002 || Math.abs(p.lift - dot.lift) > 0.03;
        circle(dot, DOT);
        if (dot.strength > 0.01) lit.push(dot);
      }
      ctx.fill();

      for (const dot of lit) {
        ctx.globalAlpha = dot.strength;
        ctx.fillStyle = dot.up ? colors.up : colors.down;
        ctx.beginPath();
        circle(dot, DOT + 1.6 * dot.strength);
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
      dots = [];
      for (let y = GAP / 2; y < height; y += GAP) {
        for (let x = GAP / 2; x < width; x += GAP) dots.push({ x, y, strength: 0, lift: 0, up: false });
      }
      cancelAnimationFrame(frame);
      draw();
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const box = canvas.getBoundingClientRect();
      cursor = { x: event.clientX - box.left, y: event.clientY - box.top };
      wake();
    };
    const leave = () => {
      cursor = undefined;
      wake();
    };

    const size = new ResizeObserver(resize);
    size.observe(canvas);
    area.addEventListener("pointermove", move);
    area.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      size.disconnect();
      area.removeEventListener("pointermove", move);
      area.removeEventListener("pointerleave", leave);
    };
  }, [still]);

  return (
    <>
      <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />
      <div
        ref={lineRef}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 h-0.5 bg-linear-to-r from-transparent via-ink to-transparent opacity-0"
        style={{ width: REACH.x * 2 }}
      />
    </>
  );
}
