import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'alm-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const H = 3_600_000;

// ---------- Claude fixture ----------
const cdir = path.join(HOME, '.claude', 'projects', 'C--proj');
fs.mkdirSync(cdir, { recursive: true });
const asst = (id: string, req: string, ago: number, model: string, u: any, sid = 'S1') =>
  JSON.stringify({ type: 'assistant', sessionId: sid, requestId: req, timestamp: iso(ago), message: { id: id, model, usage: u } });
const user = (ago: number, content: any, sid = 'S1') => JSON.stringify({ type: 'user', sessionId: sid, timestamp: iso(ago), message: { role: 'user', content } });
const u1 = { input_tokens: 10, output_tokens: 1000, cache_read_input_tokens: 100000, cache_creation_input_tokens: 20000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 20000 } };
const lines = [
  asst('m0', 'r0', 30 * H, 'claude-opus-5-5', u1, 'S0'), // yesterday-ish, other session
  user(2 * H, 'primeiro prompt'),
  asst('m1', 'r1', 2 * H - 1000, 'claude-opus-5-5', u1),
  asst('m1', 'r1', 2 * H - 900, 'claude-opus-5-5', u1), // streaming duplicate
  user(10 * 60000, 'segundo prompt'),
  asst('m2', 'r2', 9 * 60000, 'claude-opus-5-5', u1),
  user(8 * 60000, [{ type: 'tool_result', content: 'x' }]), // tool result, not a prompt
  asst('m3', 'r3', 7 * 60000, 'claude-sonnet-5-5', u1),
  asst('m4', 'r4', 6 * 60000, 'claude-unknown-9', u1),
];
fs.writeFileSync(path.join(cdir, 'S1.jsonl'), lines.join('\n') + '\n');

// ---------- Codex fixture ----------
const d = new Date();
const xdir = path.join(HOME, '.codex', 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
fs.mkdirSync(xdir, { recursive: true });
const ev = (ago: number, payload: any, type = 'event_msg') => JSON.stringify({ timestamp: iso(ago), type, payload });
const tc = (ago: number, tin: number, tcached: number, tout: number, used5: number, usedW: number) =>
  ev(ago, {
    type: 'token_count',
    info: { total_token_usage: { input_tokens: tin, cached_input_tokens: tcached, output_tokens: tout, total_tokens: tin + tout } },
    rate_limits: {
      primary: { used_percent: usedW, window_minutes: 10080, resets_at: Math.floor((now + 3 * 24 * H) / 1000) }, // weekly in primary slot on purpose
      secondary: { used_percent: used5, window_minutes: 300, resets_at: Math.floor((now + 2 * H) / 1000) },
      plan_type: 'plus',
    },
  });
const xl = [
  ev(3 * H, { id: 'X1', model: 'gpt-5.5' }, 'session_meta'),
  ev(3 * H, { model: 'gpt-5.5' }, 'turn_context'),
  ev(3 * H, { type: 'user_message', message: 'oi' }),
  tc(3 * H - 1000, 50000, 40000, 2000, 10, 30),
  tc(3 * H - 900, 50000, 40000, 2000, 10, 30), // duplicate totals -> ignored
  ev(20 * 60000, { type: 'user_message', message: 'de novo' }),
  tc(19 * 60000, 120000, 100000, 5000, 36, 47),
];
fs.writeFileSync(path.join(xdir, 'rollout-2026-10-15T12-00-00-abc.jsonl'), xl.join('\n') + '\n');

(async () => {
  const { ClaudeCollector, parseUsageResponse } = await import('../src/claude');
  const { CodexCollector } = await import('../src/codex');
  const { renderAll, statusText, statusTooltip } = await import('../src/render');

  const c = new ClaudeCollector();
  await c.scanLogs();
  (c as any).api = parseUsageResponse(
    { five_hour: { utilization: 18, resets_at: new Date(now + 2 * H).toISOString() }, seven_day: { utilization: 75, resets_at: new Date(now + 3 * 24 * H).toISOString() } },
    now
  );
  (c as any).plan = 'pro';
  const cs = c.snapshot();

  const x = new CodexCollector();
  await x.scanLogs();
  const xs = x.snapshot();

  // incremental append works
  fs.appendFileSync(path.join(cdir, 'S1.jsonl'), asst('m5', 'r5', 1000, 'claude-opus-5-5', u1) + '\n');
  await c.scanLogs();
  const cs2 = c.snapshot();

  const expectOpus = (10 * 4 + 1000 * 20 + 20000 * 8 + 100000 * 0.2) / 1e6; // 0.2 USD
  const check = (name: string, ok: boolean, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
  check('opus call cost', Math.abs(cs.periods.session.usd - (3 * expectOpus + (10 * 2 + 1000 * 10 + 20000 * 4 + 100000 * 0.1) / 1e6)) < 1e-9, cs.periods.session.usd.toFixed(4));
  check('dedupe streaming copy', cs.periods.session.calls === 4, String(cs.periods.session.calls));
  check('last prompt = 3 calls after 2nd prompt', cs.periods.lastPrompt.calls === 3, String(cs.periods.lastPrompt.calls));
  check('unknown model flagged estimated', cs.periods.lastPrompt.estimated === true);
  check('week includes other session', cs.periods.week.calls === 5, String(cs.periods.week.calls));
  check('5h window excludes 30h-old call', cs.periods.fiveHour.calls === 4);
  check('incremental append', cs2.periods.lastPrompt.calls === 4 && cs2.periods.session.calls === 5);
  check('codex 5h classified by window length', xs.fiveHour?.usedPct === 36 && xs.weekly?.usedPct === 47);
  check('codex dedupe + deltas', xs.periods.session.calls === 2, String(xs.periods.session.calls));
  const codexExpected = ((10000 * 5 + 40000 * 0.5 + 2000 * 30) + (10000 * 5 + 60000 * 0.5 + 3000 * 30)) / 1e6;
  check('codex cost', Math.abs(xs.periods.session.usd - codexExpected) < 1e-9, xs.periods.session.usd.toFixed(4) + ' vs ' + codexExpected.toFixed(4));
  check('codex last prompt', xs.periods.lastPrompt.calls === 1);

  const opts = { currency: 'both' as const, fx: { rate: 5.47, at: now, source: 'AwesomeAPI' }, barColor: '#F5C518' };
  const html = renderAll([cs2, xs], opts);
  console.log('\nSTATUS:', statusText([cs2, xs], opts, true));
  console.log('\nTOOLTIP:\n' + statusTooltip([cs2, xs], opts));
  fs.writeFileSync(path.join(__dirname, 'out-fragment.html'), html);
})();
