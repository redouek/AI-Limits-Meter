import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { JsonlTail, listJsonl, safeJson, httpsGet, toMs, startOfToday } from './util';
import { claudeCost } from './pricing';
import { UsageEntry, ProviderSnapshot, sum, LimitWindow } from './model';

const DAY = 86_400_000;
const KEEP_MS = 8 * DAY;

/** Folders where Claude Code keeps its config/transcripts. */
export function claudeDirs(): string[] {
  const dirs: string[] = [];
  const env = process.env.CLAUDE_CONFIG_DIR;
  if (env) for (const d of env.split(/[,;]/)) if (d.trim()) dirs.push(d.trim());
  dirs.push(path.join(os.homedir(), '.claude'));
  dirs.push(path.join(os.homedir(), '.config', 'claude'));
  return [...new Set(dirs)].filter((d) => fs.existsSync(d));
}

interface ApiLimits {
  fiveHour?: LimitWindow;
  weekly?: LimitWindow;
  at: number;
}

export class ClaudeCollector {
  private tails = new Map<string, JsonlTail>();
  private entries = new Map<string, UsageEntry>();
  /** sessionId -> timestamp of the latest real user prompt. */
  private lastPrompt = new Map<string, number>();
  private api?: ApiLimits;
  private apiError?: string;
  private plan?: string;
  private lastApiCall = 0;
  private lastEntryTs = 0;
  /** True when new usage arrived since the last API call (prompt finished). */
  private dirty = false;

  /** Scans transcript folders for new lines. Returns true if anything changed. */
  async scanLogs(): Promise<boolean> {
    const since = Date.now() - KEEP_MS;
    let changed = false;
    for (const root of claudeDirs()) {
      const files = await listJsonl(path.join(root, 'projects'), since, 5);
      for (const f of files) {
        let tail = this.tails.get(f);
        if (!tail) this.tails.set(f, (tail = new JsonlTail(f)));
        const { lines } = await tail.readNew();
        for (const line of lines) if (this.ingest(line)) changed = true;
      }
    }
    // prune old entries
    for (const [k, e] of this.entries) if (e.ts < since) this.entries.delete(k);
    if (changed) this.dirty = true;
    return changed;
  }

  private ingest(line: string): boolean {
    // cheap pre-filter before JSON.parse
    if (!line.includes('"usage"') && !line.includes('"type":"user"')) return false;
    const j = safeJson(line);
    if (!j) return false;
    const ts = toMs(j.timestamp);
    if (!ts) return false;
    const session: string = j.sessionId ?? '';

    if (j.type === 'user' && !j.isMeta && !j.isSidechain && isRealPrompt(j.message?.content)) {
      if (ts > (this.lastPrompt.get(session) ?? 0)) this.lastPrompt.set(session, ts);
      return true;
    }

    const msg = j.message;
    const u = msg?.usage;
    if (j.type !== 'assistant' || !u || !msg.model || msg.model === '<synthetic>') return false;

    // Streaming writes the same message several times; keep the last (most complete) copy.
    const key = msg.id ? `${msg.id}:${j.requestId ?? ''}` : (j.uuid ?? line.slice(0, 200));
    const cw1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const cwTotal = u.cache_creation_input_tokens ?? 0;
    const cw5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, cwTotal - cw1h);
    const usage = {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheWrite5m: cw5m,
      cacheWrite1h: cw1h,
      cacheRead: u.cache_read_input_tokens ?? 0,
    };
    const fast = u.speed === 'fast' || msg.speed === 'fast';
    const { usd, known } = claudeCost(msg.model, usage, fast);
    this.entries.set(key, {
      ts,
      session,
      model: msg.model,
      input: usage.input,
      output: usage.output,
      cacheWrite: cw5m + cw1h,
      cacheRead: usage.cacheRead,
      usd,
      priced: known,
    });
    if (ts > this.lastEntryTs) this.lastEntryTs = ts;
    return true;
  }

  /**
   * Fetches the official 5h/weekly utilization (same source as the "Usage" screen).
   * Throttled: at most once per `minIntervalMs`, and earlier only if a prompt finished.
   */
  async refreshLimits(pollMs: number, force = false): Promise<void> {
    const now = Date.now();
    const minGap = 60_000;
    const due = now - this.lastApiCall >= pollMs || (this.dirty && now - this.lastApiCall >= minGap);
    if (!force && !due) return;
    if (force && now - this.lastApiCall < 15_000) return;
    this.lastApiCall = now;
    const wasDirty = this.dirty;
    this.dirty = false;

    // Several VS Code windows share one cache file so they don't multiply API calls.
    const cached = await readSharedCache();
    if (cached && now - cached.at < (wasDirty || force ? minGap : pollMs)) {
      this.api = cached;
      this.apiError = undefined;
      return;
    }

    const cred = await readCredentials();
    if (!cred) {
      this.apiError = 'noCredentials';
      return;
    }
    this.plan = cred.plan ?? this.plan;
    if (cred.expiresAt && cred.expiresAt < now) {
      this.apiError = 'tokenExpired';
      return;
    }
    try {
      const res = await httpsGet('https://api.anthropic.com/api/oauth/usage', {
        Authorization: `Bearer ${cred.token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'ai-limits-meter-vscode',
        Accept: 'application/json',
      });
      if (res.status === 401 || res.status === 403) {
        this.apiError = 'tokenExpired';
        return;
      }
      if (res.status === 429) {
        this.apiError = 'rateLimited';
        return;
      }
      if (res.status !== 200) {
        this.apiError = `http${res.status}`;
        return;
      }
      this.api = parseUsageResponse(JSON.parse(res.body), now);
      this.apiError = undefined;
      await writeSharedCache(this.api);
    } catch (e: any) {
      this.apiError = 'network';
    }
  }

  snapshot(): ProviderSnapshot {
    const now = Date.now();
    const all = [...this.entries.values()];
    const api = this.api;

    // A window whose reset already passed is fresh again.
    const live = (w?: LimitWindow): LimitWindow | undefined =>
      w && w.resetsAt && w.resetsAt <= now ? { usedPct: 0, resetsAt: undefined } : w;
    const fiveHour = live(api?.fiveHour);
    const weekly = live(api?.weekly);

    const fiveStart = api?.fiveHour?.resetsAt && api.fiveHour.resetsAt > now ? api.fiveHour.resetsAt - 5 * 3_600_000 : now - 5 * 3_600_000;
    const weekStart = api?.weekly?.resetsAt && api.weekly.resetsAt > now ? api.weekly.resetsAt - 7 * DAY : now - 7 * DAY;

    // Current session = the one with the most recent activity.
    let curSession = '';
    let latest = 0;
    for (const e of all) if (e.ts > latest) ((latest = e.ts), (curSession = e.session));
    const promptTs = this.lastPrompt.get(curSession) ?? 0;

    return {
      id: 'claude',
      available: all.length > 0 || !!api || claudeDirs().length > 0,
      plan: this.plan,
      fiveHour,
      weekly,
      limitsAt: api?.at,
      limitsError: this.apiError,
      rollingPeriods: !api,
      periods: {
        lastPrompt: sum(all, (e) => e.session === curSession && e.ts >= promptTs),
        session: sum(all, (e) => e.session === curSession),
        fiveHour: sum(all, (e) => e.ts >= fiveStart),
        today: sum(all, (e) => e.ts >= startOfToday(now)),
        week: sum(all, (e) => e.ts >= weekStart),
      },
    };
  }
}

export function parseUsageResponse(j: any, now: number): ApiLimits {
  const win = (w: any): LimitWindow | undefined =>
    w && typeof w.utilization === 'number' ? { usedPct: w.utilization, resetsAt: toMs(w.resets_at) } : undefined;
  return { fiveHour: win(j?.five_hour), weekly: win(j?.seven_day), at: now };
}

const CACHE_FILE = path.join(os.tmpdir(), 'ai-limits-meter-claude-limits.json');

async function readSharedCache(): Promise<ApiLimits | undefined> {
  try {
    const j = JSON.parse(await fs.promises.readFile(CACHE_FILE, 'utf8'));
    return typeof j?.at === 'number' ? (j as ApiLimits) : undefined;
  } catch {
    return undefined;
  }
}

async function writeSharedCache(v: ApiLimits): Promise<void> {
  try {
    await fs.promises.writeFile(CACHE_FILE, JSON.stringify(v), 'utf8');
  } catch {
    /* best effort */
  }
}

function isRealPrompt(content: unknown): boolean {
  if (typeof content === 'string') return !content.startsWith('<command-') && !content.startsWith('<local-command');
  if (Array.isArray(content)) return content.some((c) => c?.type === 'text' && typeof c.text === 'string');
  return false;
}

interface Cred {
  token: string;
  expiresAt?: number;
  plan?: string;
}

/** Reads the OAuth token Claude Code already stores. It is only ever sent to api.anthropic.com. */
async function readCredentials(): Promise<Cred | undefined> {
  const parse = (raw: string): Cred | undefined => {
    const j = safeJson(raw);
    const o = j?.claudeAiOauth;
    if (!o?.accessToken) return undefined;
    return { token: o.accessToken, expiresAt: toMs(o.expiresAt), plan: o.subscriptionType };
  };
  for (const d of claudeDirs()) {
    try {
      const c = parse(await fs.promises.readFile(path.join(d, '.credentials.json'), 'utf8'));
      if (c) return c;
    } catch {
      /* try next */
    }
  }
  if (process.platform === 'darwin') {
    const raw = await new Promise<string>((resolve) =>
      execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], (err, out) =>
        resolve(err ? '' : out.trim())
      )
    );
    if (raw) return parse(raw);
  }
  return undefined;
}
