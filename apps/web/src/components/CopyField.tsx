import { useState } from "react";

export function CopyButton({ value, what }: { value: string; what: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? `${what} copied` : `Copy ${what}`}
      onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}
      className="shrink-0 rounded-lg bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-paper"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-well p-3">
      <p className="text-xs text-ink-2">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 font-mono text-sm break-all">{value}</code>
        <CopyButton value={value} what={label.toLowerCase()} />
      </div>
    </div>
  );
}
