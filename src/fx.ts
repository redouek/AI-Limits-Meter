import * as vscode from 'vscode';
import { httpsGet } from './util';

const KEY = 'aiLimitsMeter.fx';
const DAY = 86_400_000;

export interface FxRate {
  rate: number;
  at: number;
  source: string;
}

/** USD→BRL rate, fetched at most once a day from free keyless APIs and cached. */
export class Fx {
  private cached?: FxRate;
  private inflight?: Promise<void>;

  constructor(private state: vscode.Memento) {
    this.cached = state.get<FxRate>(KEY);
  }

  current(): FxRate | undefined {
    const cfg = vscode.workspace.getConfiguration('aiLimitsMeter');
    const fixed = cfg.get<number>('usdToBrl', 0);
    if (fixed && fixed > 0) return { rate: fixed, at: Date.now(), source: 'manual' };
    return this.cached;
  }

  async ensure(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('aiLimitsMeter');
    if ((cfg.get<number>('usdToBrl', 0) ?? 0) > 0) return;
    if (this.cached && Date.now() - this.cached.at < DAY) return;
    if (this.inflight) return this.inflight;
    this.inflight = this.fetch().finally(() => (this.inflight = undefined));
    return this.inflight;
  }

  private async fetch(): Promise<void> {
    const sources: [string, string, (j: any) => number][] = [
      ['AwesomeAPI', 'https://economia.awesomeapi.com.br/json/last/USD-BRL', (j) => Number(j?.USDBRL?.bid)],
      ['ExchangeRate-API', 'https://open.er-api.com/v6/latest/USD', (j) => Number(j?.rates?.BRL)],
    ];
    for (const [name, url, pick] of sources) {
      try {
        const res = await httpsGet(url, { Accept: 'application/json', 'User-Agent': 'ai-limits-meter-vscode' }, 10000);
        if (res.status !== 200) continue;
        const rate = pick(JSON.parse(res.body));
        if (rate > 0 && rate < 100) {
          this.cached = { rate, at: Date.now(), source: name };
          await this.state.update(KEY, this.cached);
          return;
        }
      } catch {
        /* try next */
      }
    }
  }
}
