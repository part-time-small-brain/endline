import { ShareNetwork } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { Card } from "../lib/shareCard.ts";
import { Button } from "./Button.tsx";

const WIDTH = 1200;
const HEIGHT = 630;

async function drawCard(card: Card): Promise<File> {
  await Promise.all(["600 64px 'Mona Sans Variable'", "500 32px 'Geist Mono Variable'"].map((font) => document.fonts.load(font)));
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  const canvas = Object.assign(document.createElement("canvas"), { width: WIDTH, height: HEIGHT });
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = token("--page");
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.strokeStyle = token("--up");
  ctx.lineWidth = 6;
  for (const [x, y, dx, dy] of [[40, 40, 1, 1], [WIDTH - 40, 40, -1, 1], [40, HEIGHT - 40, 1, -1], [WIDTH - 40, HEIGHT - 40, -1, -1]] as const) {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * 48);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * 48, y);
    ctx.stroke();
  }
  const text = (value: string, y: number, font: string, color: string) => {
    ctx.font = font;
    ctx.fillStyle = token(color);
    ctx.fillText(value, 96, y);
  };
  text("ENDLINE", 140, "500 28px 'Geist Mono Variable'", "--ink-3");
  text(card.title, 250, "600 64px 'Mona Sans Variable'", "--ink");
  text(card.result, 360, "700 96px 'Mona Sans Variable'", "--up");
  text(card.detail, 430, "500 32px 'Geist Mono Variable'", "--ink-2");
  text(card.footer, 520, "500 28px 'Geist Mono Variable'", "--ink-3");
  text("endline.trade", 570, "500 28px 'Geist Mono Variable'", "--teal");
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("no image");
  return new File([blob], "endline-win.png", { type: "image/png" });
}

const KEEP_URL_MS = 60_000;

function download(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.body.appendChild(Object.assign(document.createElement("a"), { href: url, download: file.name }));
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), KEEP_URL_MS);
}

export function ShareButton({ card }: { card: Card }) {
  const [file, setFile] = useState<File | null>();
  const { title, result, detail, footer, text } = card;
  // drawn before the click: an await inside the click handler uses up the user activation navigator.share needs on iOS
  useEffect(() => {
    let live = true;
    drawCard({ title, result, detail, footer, text }).then(
      (drawn) => live && setFile(drawn),
      () => live && setFile(null),
    );
    return () => {
      live = false;
    };
  }, [title, result, detail, footer, text]);

  const share = () => {
    if (!file) return;
    if (!navigator.canShare?.({ files: [file] })) return download(file);
    navigator.share({ files: [file], text }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) download(file);
    });
  };

  if (file === null) return null;
  return (
    <Button tone="ghost" disabled={!file} onClick={share}>
      <ShareNetwork size={16} weight="bold" aria-hidden="true" />
      Share
    </Button>
  );
}
