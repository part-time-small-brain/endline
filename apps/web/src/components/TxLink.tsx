import { useApp } from "../app/context.ts";

export function txUrl(network: string, hash: string): string | undefined {
  if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash)) return undefined;
  return `https://${network === "testnet" ? "testnet.nearblocks.io" : "nearblocks.io"}/txns/${hash}`;
}

export function TxLink({ hash, className = "" }: { hash: string; className?: string }) {
  const { config } = useApp();
  const href = txUrl(config.network, hash);
  if (config.mock || !href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`text-sm text-ink-2 underline decoration-rule underline-offset-4 hover:text-ink ${className}`}>
      View transaction ↗
    </a>
  );
}
