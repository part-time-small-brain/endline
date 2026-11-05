import { EXPIRY_TIME_OF_DAY, SECONDS_PER_DAY as DAY_SEC } from "@near-options/sdk";

const local = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, options);
const weekday = local({ weekday: "short" });
const dayMonth = local({ day: "numeric", month: "short" });
const dayOfMonth = local({ day: "numeric" });
const clock = local({ hour: "numeric", minute: "2-digit" });
const utcClock = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const date = (sec: number) => new Date(sec * 1000);
const localDay = (sec: number) => {
  const d = date(sec);
  return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / (DAY_SEC * 1000));
};

export const isDailyExpiry = (expiry: number) => expiry % DAY_SEC === EXPIRY_TIME_OF_DAY;

export function formatEnds(expiry: number): string {
  const d = date(expiry);
  return `${weekday.format(d)} ${dayMonth.format(d)}, ${clock.format(d)}`;
}

export function formatClock(sec: number): string {
  return clock.format(date(sec));
}

export function formatUtc(sec: number): string {
  return `${utcClock.format(date(sec))} UTC`;
}

export function dayLabel(sec: number, nowSec: number): string {
  const days = localDay(sec) - localDay(nowSec);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1 && days < 7) return `${weekday.format(date(sec))} ${dayOfMonth.format(date(sec))}`;
  return dayMonth.format(date(sec));
}

export function countdown(seconds: number): string {
  const s = Math.max(Math.floor(seconds), 0);
  const d = Math.floor(s / DAY_SEC);
  const h = Math.floor((s % DAY_SEC) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function clockParts(seconds: number): { value: number; unit: "d" | "h" | "m" | "s" }[] {
  const s = Math.max(Math.floor(seconds), 0);
  const d = Math.floor(s / DAY_SEC);
  const h = Math.floor((s % DAY_SEC) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0)
    return [
      { value: d, unit: "d" },
      { value: h, unit: "h" },
    ];
  if (h > 0)
    return [
      { value: h, unit: "h" },
      { value: m, unit: "m" },
    ];
  return [
    { value: m, unit: "m" },
    { value: s % 60, unit: "s" },
  ];
}

export function expiryChips(expiries: number[], nowSec: number): { expiry: number; label: string; hint?: string }[] {
  const daily = expiries.every(isDailyExpiry);
  return expiries.map((expiry) => ({ expiry, label: dayLabel(expiry, nowSec), ...(daily ? {} : { hint: formatClock(expiry) }) }));
}
