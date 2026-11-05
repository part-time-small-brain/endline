export class KillSwitch {
  private readonly reasons = new Map<string, string>();

  constructor(private readonly log: (line: string) => void) {}

  trip(key: string, detail: string): void {
    if (!this.reasons.has(key)) this.log(`kill switch ${key}: ${detail}`);
    this.reasons.set(key, detail);
  }

  clear(key: string): void {
    if (this.reasons.delete(key)) this.log(`kill switch ${key} cleared`);
  }

  reason(): string | undefined {
    const entries = [...this.reasons].map(([key, detail]) => `${key}: ${detail}`);
    return entries.length === 0 ? undefined : entries.join("; ");
  }
}
