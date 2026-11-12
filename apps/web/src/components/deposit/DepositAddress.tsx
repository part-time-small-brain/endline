import type { DepositStatus } from "../../api/oneClick.ts";
import { chainName } from "../../lib/depositMenu.ts";
import { formatToken } from "../../lib/money.ts";
import type { DepositStage, PendingDeposit } from "../../lib/pendingDeposit.ts";
import { countdown, formatEnds } from "../../lib/time.ts";
import { CopyButton, CopyField } from "../CopyField.tsx";
import { ChainLabel } from "./AssetLabel.tsx";
import { QrCode } from "./QrCode.tsx";

const STEPS = ["Waiting for your transfer", "Transfer seen", "Converting to USDC", "Credited"];
const REACHED: Partial<Record<DepositStatus, number>> = { PENDING_DEPOSIT: 0, KNOWN_DEPOSIT_TX: 1, PROCESSING: 2, SUCCESS: 3 };
const ONLY_USDC = "The app shows only USDC, so check your NEAR Intents wallet.";
const PROBLEMS: Partial<Record<DepositStatus, (symbol: string) => string>> = {
  INCOMPLETE_DEPOSIT: (symbol) => `Less than expected arrived. It will be refunded as ${symbol} to your NEAR Intents account.`,
  REFUNDED: (symbol) => `Refunded. Your ${symbol} is back in your NEAR Intents account. ${ONLY_USDC}`,
  FAILED: (symbol) => `Deposit failed. Any ${symbol} that arrived is refunded to your NEAR Intents account. ${ONLY_USDC}`,
};

interface Props {
  deposit: PendingDeposit;
  status: DepositStatus | undefined;
  stage: DepositStage;
  quoteDecimals: number;
  onBack: () => void;
}

export function DepositAddress({ deposit, status, stage, quoteDecimals, onBack }: Props) {
  const { asset } = deposit;
  const amount = formatToken(BigInt(deposit.amountIn), asset.decimals, asset.decimals);
  const chain = chainName(asset.blockchain);
  const reached = REACHED[status ?? "PENDING_DEPOSIT"] ?? 0;
  const problem = status && PROBLEMS[status]?.(asset.symbol);

  return (
    <div className="space-y-4">
      {stage !== "seen" && (
        <button type="button" onClick={onBack} className="text-sm text-ink-2 hover:text-ink">
          <span aria-hidden="true">←</span> Back
        </button>
      )}
      {stage === "expired" ? (
        <p role="status" className="rounded-2xl bg-well px-4 py-3 text-sm">
          This address has expired. Get a new one.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-well p-3">
            <h3 tabIndex={-1} className="min-w-0 break-words outline-none">
              Send exactly{" "}
              <span className="font-semibold">
                {amount} {asset.symbol}
              </span>{" "}
              on {chain}
            </h3>
            <CopyButton value={amount.replaceAll(",", "")} what="amount" />
          </div>
          <div className="flex justify-center">
            <QrCode value={deposit.depositAddress} />
          </div>
          <CopyField label="Deposit address" value={deposit.depositAddress} />
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-xl bg-well px-3 py-2">
              <dt className="text-xs text-ink-2">Network</dt>
              <dd className="font-semibold">
                <ChainLabel code={asset.blockchain} />
              </dd>
            </div>
            <div className="rounded-xl bg-well px-3 py-2">
              <dt className="text-xs text-ink-2">Arrives in</dt>
              <dd className="font-semibold">~{countdown(deposit.timeEstimate)}</dd>
            </div>
            <div className="rounded-xl bg-well px-3 py-2">
              <dt className="text-xs text-ink-2">Send before</dt>
              <dd className="font-semibold">{formatEnds(Date.parse(deposit.deadline) / 1000)}</dd>
            </div>
          </dl>
          <p className="text-sm text-danger">
            Only send {asset.symbol} on {chain}. Anything else may be lost.
          </p>
          {problem ? (
            <p role="status" className="rounded-2xl bg-well px-4 py-3 text-sm">
              {problem}
            </p>
          ) : (
            <ol aria-label="Deposit status" aria-live="polite" className="space-y-2 rounded-2xl bg-well px-4 py-3 text-sm">
              {STEPS.map((label, i) => {
                const done = i < reached || status === "SUCCESS";
                return (
                  <li key={label} aria-current={i === reached ? "step" : undefined} className={`flex items-center gap-3 ${done || i === reached ? "text-ink" : "text-ink-3"}`}>
                    <span className={`size-2 shrink-0 rounded-full ${done ? "bg-ink" : i === reached ? "animate-pulse bg-ink-2" : "bg-paper"}`} />
                    {label}
                    {i === STEPS.length - 1 && <span className="ml-auto">≈ +{formatToken(BigInt(deposit.amountOut), quoteDecimals, 2)} USDC</span>}
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
