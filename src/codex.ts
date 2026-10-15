import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonlTail, safeJson, toMs, startOfToday } from './util';
import { openaiCost } from './pricing';
import { UsageEntry, ProviderSnapshot, sum, LimitWindow } from './model';

const DAY = 86_400_000;
const KEEP_MS = 8 * DAY;

export function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

interface FileState {
  tail: JsonlTail;
  model: string;
  prevTotal?: { input: number; cached: number; output: number };
  lastPrompt: number;
  lastTs: number;
}

interface RateSnap {
  ts: number;
  fiveHour?: LimitWindow;
  weekly?: LimitWindow;
  plan?: string;
}

export class CodexCollector {
  private files = new Map<string, FileState>();
  private entries: UsageEntry[] = [];
  private rate?: RateSnap;

  /** Session files live in sessions/YYYY/MM/DD/rollout-*.jsonl — only recent days are scanned. */
  private async recentFiles(): Promise<string[]> {
    const root = path.join(codexHome(), 'sessions');
    const out: string[] = [];
    const since = Date.now() - KEEP_MS;
    for (let i = 0; i <= 9; i++) {
      const d = new Date(Date.now() - i * DAY);
      const dir = path.join(
        root,
        String(d.getFullYear()),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0')
      );
      let names: string[];
      try {
        names = await fs.promises.readdir(dir);
      } catch {
        continue;
      }
      for (const n of names) {
        if (!n.endsWith('.jsonl')) continue;
        const p = path.join(dir, n);
        try {
          if ((await fs.promises.stat(p)).mtimeMs >= since) out.push(p);
        } catch {
          /* ignore */
        }
      }
    }
    // Long-lived sessions keep writing to the file of the day they started; the
    // 10-day window above plus the mtime filter covers them.
    return [...new Set(out)];
  }

  async scanLogs(): Promise<boolean> {
    let changed = false;
    for (const f of await this.recentFiles()) {
      let st = this.files.get(f);
      if (!st) this.files.set(f, (st = { tail: new JsonlTail(f), model: '', lastPrompt: 0, lastTs: 0 }));
      const { lines, reset } = await st.tail.readNew();
      if (reset) {
        this.entries = this.entries.filter((e) => e.session !== f);
        st.prevTotal = undefined;
      }
      for (const line of lines) if (this.ingest(f, st, line)) changed = true;
    }
    const since = Date.now() - KEEP_MS;
    this.entries = this.entries.filter((e) => e.ts >= since);
    return changed;
  }

  private ingest(file: string, st: FileState, line: string): boolean {
    const j = safeJson(line);
    if (!j) return false;
    const ts = toMs(j.timestamp) ?? Date.now();
    const p = j.payload ?? j;
    if (ts > st.lastTs) st.lastTs = ts;

    if ((j.type === 'turn_context' || j.type === 'session_meta') && typeof p.model === 'string') {
      st.model = p.model;
      return false;
    }
    if (p.type === 'user_message') {
      st.lastPrompt = Math.max(st.lastPrompt, ts);
      return true;
    }
    if (p.type !== 'token_count') return false;

    let changed = false;
    if (p.rate_limits) {
      const snap = parseRate(p.rate_limits, ts);
      if (snap && (!this.rate || ts >= this.rate.ts)) {
        this.rate = snap;
        changed = true;
      }
    }

    const tot = p.info?.total_token_usage;
    const last = p.info?.last_token_usage;
    let d: { input: number; cached: number; output: number } | undefined;
    if (tot) {
      const cur = {
        input: tot.input_tokens ?? 0,
        cached: tot.cached_input_tokens ?? 0,
        output: tot.output_tokens ?? 0,
      };
      const prev = st.prevTotal;
      if (!prev || cur.input + cur.output < prev.input + prev.output) {
        // first event of the file (or counter reset): use last_token_usage if present
        d = last
          ? { input: last.input_tokens ?? 0, cached: last.cached_input_tokens ?? 0, output: last.output_tokens ?? 0 }
          : prev
            ? undefined
            : cur;
      } else {
        d = { input: cur.input - prev.input, cached: cur.cached - prev.cached, output: cur.output - prev.output };
      }
      st.prevTotal = cur;
    }
    if (d && d.input + d.output > 0) {
      const { usd, known } = openaiCost(st.model, d);
      this.entries.push({
        ts,
        session: file,
        model: st.model || 'gpt',
        input: Math.max(0, d.input - d.cached),
        output: d.output,
        cacheWrite: 0,
        cacheRead: Math.max(0, d.cached),
        usd,
        priced: known,
      });
      changed = true;
    }
    return changed;
  }

  snapshot(): ProviderSnapshot {
    const now = Date.now();
    const r = this.rate;
    const live = (w?: LimitWindow): LimitWindow | undefined =>
      w && w.resetsAt && w.resetsAt <= now ? { usedPct: 0, resetsAt: undefined } : w;

    const fiveStart = r?.fiveHour?.resetsAt && r.fiveHour.resetsAt > now ? r.fiveHour.resetsAt - 5 * 3_600_000 : now - 5 * 3_600_000;
    const weekStart = r?.weekly?.resetsAt && r.weekly.resetsAt > now ? r.weekly.resetsAt - 7 * DAY : now - 7 * DAY;

    let cur: string | undefined;
    let latest = 0;
    for (const [f, st] of this.files) if (st.lastTs > latest) ((latest = st.lastTs), (cur = f));
    const promptTs = cur ? this.files.get(cur)!.lastPrompt : 0;
    const all = this.entries;

    return {
      id: 'codex',
      available: all.length > 0 || !!r || fs.existsSync(codexHome()),
      plan: r?.plan,
      fiveHour: live(r?.fiveHour),
      weekly: live(r?.weekly),
      limitsAt: r?.ts,
      limitsError: r ? undefined : 'noCodexData',
      rollingPeriods: !r,
      periods: {
        lastPrompt: sum(all, (e) => e.session === cur && e.ts >= promptTs),
        session: sum(all, (e) => e.session === cur),
        fiveHour: sum(all, (e) => e.ts >= fiveStart),
        today: sum(all, (e) => e.ts >= startOfToday(now)),
        week: sum(all, (e) => e.ts >= weekStart),
      },
    };
  }
}

/** Codex does not keep windows in fixed slots — classify by window length. */
function parseRate(rl: any, eventTs: number): RateSnap | undefined {
  const snap: RateSnap = { ts: eventTs, plan: rl.plan_type };
  for (const slot of ['primary', 'secondary']) {
    const w = rl[slot];
    if (!w || typeof w.used_percent !== 'number') continue;
    const mins: number | undefined = w.window_minutes;
    const resetsAt = toMs(w.resets_at) ?? (typeof w.resets_in_seconds === 'number' ? eventTs + w.resets_in_seconds * 1000 : undefined);
    const win: LimitWindow = { usedPct: w.used_percent, resetsAt };
    const isWeekly = mins !== undefined ? mins > 24 * 60 : slot === 'secondary';
    if (isWeekly) snap.weekly = win;
    else snap.fiveHour = win;
  }
  return snap.fiveHour || snap.weekly ? snap : undefined;
}
