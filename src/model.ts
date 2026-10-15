/** One API call worth of usage, normalized across providers. */
export interface UsageEntry {
  ts: number;
  session: string;
  model: string;
  /** Uncached input tokens. */
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  usd: number;
  /** false when the model was not in the price table (cost is an estimate). */
  priced: boolean;
}

export interface Totals {
  usd: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  tokens: number;
  calls: number;
  estimated: boolean;
}

export function emptyTotals(): Totals {
  return { usd: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, tokens: 0, calls: 0, estimated: false };
}

export function sum(entries: Iterable<UsageEntry>, pred: (e: UsageEntry) => boolean): Totals {
  const t = emptyTotals();
  for (const e of entries) {
    if (!pred(e)) continue;
    t.usd += e.usd;
    t.input += e.input;
    t.output += e.output;
    t.cacheWrite += e.cacheWrite;
    t.cacheRead += e.cacheRead;
    t.calls++;
    if (!e.priced) t.estimated = true;
  }
  t.tokens = t.input + t.output + t.cacheWrite + t.cacheRead;
  return t;
}

export interface LimitWindow {
  /** 0–100, percent USED. */
  usedPct: number;
  resetsAt?: number;
}

export interface ProviderSnapshot {
  id: 'claude' | 'codex';
  available: boolean;
  plan?: string;
  fiveHour?: LimitWindow;
  weekly?: LimitWindow;
  /** When the limit numbers were obtained. */
  limitsAt?: number;
  /** Human-readable problem with the limits source, if any. */
  limitsError?: string;
  periods: {
    lastPrompt: Totals;
    session: Totals;
    fiveHour: Totals;
    today: Totals;
    week: Totals;
  };
  /** True when 5h/week periods are rolling fallbacks (no reset info). */
  rollingPeriods: boolean;
}
