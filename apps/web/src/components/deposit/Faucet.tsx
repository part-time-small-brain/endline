import { useState } from "react";
import { RelayError } from "../../api/relay.ts";
import { useApp } from "../../app/context.ts";
import { useData } from "../../app/data.tsx";
import { Button } from "../Button.tsx";

interface Result {
  tone: "sent" | "limited" | "error";
  text: string;
}

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}${text.endsWith(".") ? "" : "."}`;

export function Faucet({ accountId }: { accountId: string }) {
  const { services } = useApp();
  const { reload } = useData();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>();

  const drip = async () => {
    setBusy(true);
    setResult(undefined);
    try {
      await services.relay.faucet(accountId);
      setResult({ tone: "sent", text: "Sent. Your balance updates in a few seconds." });
      reload();
    } catch (e) {
      if (!(e instanceof RelayError)) setResult({ tone: "error", text: "Couldn't reach the faucet. Try again." });
      else setResult({ tone: e.status === 429 ? "limited" : "error", text: sentence(e.message) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Button size="lg" disabled={busy || result?.tone === "sent"} onClick={() => void drip()}>
        {busy ? "Sending…" : "Get 100 test USDC"}
      </Button>
      {result && (
        <p role="status" className={`text-sm ${result.tone === "sent" ? "font-semibold text-ink" : result.tone === "limited" ? "text-ink-2" : "text-danger"}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}
