import { useApp } from "../app/context.ts";

export function TxLink({ hash, className = "" }: { hash: string; className?: string }) {
  const { config } = useApp();
  if (config.mock) return null;
  const host = config.network === "testnet" ? "testnet.nearblocks.io" : "nearblocks.io";
  return (
    <a href={`https://${host}/txns/${hash}`} target="_blank" rel="noreferrer" className={`text-sm text-ink-2 underline decoration-rule underline-offset-4 hover:text-ink ${className}`}>
      View transaction ↗
    </a>
  );
}
