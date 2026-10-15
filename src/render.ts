import { ProviderSnapshot, Totals, LimitWindow } from './model';
import { strings, locale, errorText } from './i18n';
import { FxRate } from './fx';

export type CurrencyMode = 'both' | 'brl' | 'usd';

export interface RenderOpts {
  currency: CurrencyMode;
  fx?: FxRate;
  barColor: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function fmtMoney(usd: number, cur: 'BRL' | 'USD', fx?: FxRate): string {
  const value = cur === 'BRL' ? (fx ? usd * fx.rate : NaN) : usd;
  if (Number.isNaN(value)) return 'R$ —';
  const digits = value !== 0 && Math.abs(value) < 0.1 ? 3 : 2;
  return new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: cur,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function fmtTokens(n: number): string {
  const nf = (v: number, d: number) => new Intl.NumberFormat(locale(), { maximumFractionDigits: d }).format(v);
  if (n < 1000) return nf(n, 0);
  if (n < 1e6) return nf(n / 1e3, n < 1e4 ? 1 : 0) + 'k';
  if (n < 1e9) return nf(n / 1e6, n < 1e7 ? 2 : 1) + 'M';
  return nf(n / 1e9, 2) + 'B';
}

function fmtReset(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const hm = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(d);
  if (d.toDateString() === now.toDateString()) return hm;
  const dm = new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit' }).format(d);
  return `${dm} ${hm}`;
}

function fmtIn(ts?: number): string {
  if (!ts) return '';
  const mins = Math.max(0, Math.round((ts - Date.now()) / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
}

export function money(usd: number, o: RenderOpts): string {
  if (o.currency === 'usd') return fmtMoney(usd, 'USD');
  if (o.currency === 'brl') return fmtMoney(usd, 'BRL', o.fx);
  return `${fmtMoney(usd, 'BRL', o.fx)} · ${fmtMoney(usd, 'USD')}`;
}

export function barColorFor(remainingPct: number, base: string): string {
  if (remainingPct <= 8) return '#E5484D';
  if (remainingPct <= 20) return '#F2802B';
  return base;
}

function limitRow(label: string, w: LimitWindow | undefined, o: RenderOpts): string {
  const s = strings();
  if (!w) {
    return `<div class="row"><span class="lbl">${esc(label)}</span><div class="bar empty"></div><span class="meta dim">—</span></div>`;
  }
  const used = Math.max(0, Math.min(100, w.usedPct));
  const color = barColorFor(100 - used, o.barColor);
  const reset = w.resetsAt ? `${s.resets} ${fmtReset(w.resetsAt)}` : s.renewed;
  const title = w.resetsAt ? `${Math.round(w.usedPct)}% ${s.used} · ${s.resets} ${s.inTime} ${fmtIn(w.resetsAt)}` : '';
  return `<div class="row" title="${esc(title)}">
    <span class="lbl">${esc(label)}</span>
    <div class="bar"><div class="fill" style="width:${used.toFixed(1)}%;background:${color}"></div></div>
    <span class="meta"><b style="color:${color}">${Math.round(used)}%</b><span class="w"> ${s.used}</span> · ${esc(reset)}</span>
  </div>`;
}

function totalsTitle(t: Totals): string {
  const s = strings();
  const parts = [
    `${s.input}: ${fmtTokens(t.input)}`,
    `${s.output}: ${fmtTokens(t.output)}`,
    `${s.cacheWrite}: ${fmtTokens(t.cacheWrite)}`,
    `${s.cacheRead}: ${fmtTokens(t.cacheRead)}`,
    `${s.calls}: ${t.calls}`,
  ];
  if (t.estimated) parts.push(s.estimatedModel);
  return parts.join('\n');
}

function costTable(p: ProviderSnapshot, o: RenderOpts): string {
  const s = strings();
  const rows: [string, Totals][] = [
    [s.lastPrompt, p.periods.lastPrompt],
    [s.session, p.periods.session],
    [p.rollingPeriods ? s.last5h : s.window5h, p.periods.fiveHour],
    [s.today, p.periods.today],
    [p.rollingPeriods ? s.last7d : s.week, p.periods.week],
  ];
  const showBrl = o.currency !== 'usd';
  const showUsd = o.currency !== 'brl';
  const body = rows
    .map(
      ([label, t]) => `<tr title="${esc(totalsTitle(t))}">
        <td class="lbl">${esc(label)}</td>
        ${showBrl ? `<td class="num">${t.estimated ? '~' : ''}${fmtMoney(t.usd, 'BRL', o.fx)}</td>` : ''}
        ${showUsd ? `<td class="num">${t.estimated ? '~' : ''}${fmtMoney(t.usd, 'USD')}</td>` : ''}
        <td class="num dim">${fmtTokens(t.tokens)}</td>
      </tr>`
    )
    .join('');
  return `<table class="costs">
    <thead><tr><th></th>${showBrl ? '<th>R$</th>' : ''}${showUsd ? '<th>US$</th>' : ''}<th>${s.tokens}</th></tr></thead>
    <tbody>${body}</tbody></table>`;
}

const NAMES = { claude: 'Claude Code', codex: 'Codex' };

export function renderProvider(p: ProviderSnapshot, o: RenderOpts): string {
  const s = strings();
  const err = errorText(p.limitsError);
  const upd = p.limitsAt
    ? new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(p.limitsAt))
    : '';
  const updTitle = p.id === 'codex' && p.limitsAt ? s.limitsFromLogs : s.updated;
  return `<section class="prov" data-id="${p.id}">
    <header>
      <button class="toggle" data-toggle="${p.id}" aria-label="toggle">▾</button>
      <span class="name">${NAMES[p.id]}</span>${p.plan ? `<span class="plan">${esc(p.plan)}</span>` : ''}
      <span class="upd" title="${esc(updTitle)}">${upd ? '⟳ ' + upd : ''}</span>
    </header>
    ${limitRow(s.limit5h, p.fiveHour, o)}
    ${limitRow(s.limitWeek, p.weekly, o)}
    ${err ? `<div class="warn">${esc(err)}</div>` : ''}
    <div class="more">
      ${costTable(p, o)}
    </div>
  </section>`;
}

export function renderAll(ps: ProviderSnapshot[], o: RenderOpts): string {
  const s = strings();
  if (!ps.length) return `<div class="dim pad">${s.noData}</div>`;
  const fx = o.fx
    ? `${s.fx}: US$ 1 = ${fmtMoney(o.fx.rate, 'BRL', { rate: 1, at: 0, source: '' })} (${esc(o.fx.source)})`
    : '';
  return (
    ps.map((p) => renderProvider(p, o)).join('') +
    `<footer><span title="${esc(s.estimate)}">ⓘ ${esc(s.estimate)}</span>${fx && o.currency !== 'usd' ? `<span>${fx}</span>` : ''}</footer>`
  );
}

/** Short text for the status bar. */
export function statusText(ps: ProviderSnapshot[], o: RenderOpts, withCost: boolean): string {
  const pct = (w?: LimitWindow) => (w ? `${Math.round(Math.max(0, Math.min(100, w.usedPct)))}%` : '–');
  const parts = ps.map((p) => `${p.id === 'claude' ? 'Claude' : 'Codex'} ${pct(p.fiveHour)}·${pct(p.weekly)}`);
  if (withCost) {
    const usd = ps.reduce((a, p) => a + p.periods.today.usd, 0);
    parts.push(o.currency === 'usd' || !o.fx ? fmtMoney(usd, 'USD') : fmtMoney(usd, 'BRL', o.fx));
  }
  return '$(dashboard) ' + parts.join('  ');
}

export function minRemaining(ps: ProviderSnapshot[]): number {
  let m = 100;
  for (const p of ps) for (const w of [p.fiveHour, p.weekly]) if (w) m = Math.min(m, 100 - w.usedPct);
  return m;
}

/** Markdown tooltip for the status bar item. */
export function statusTooltip(ps: ProviderSnapshot[], o: RenderOpts): string {
  const s = strings();
  const lines: string[] = [];
  for (const p of ps) {
    lines.push(`**${NAMES[p.id]}**${p.plan ? ` · ${p.plan}` : ''}`);
    lines.push('');
    const w = (label: string, x?: LimitWindow) =>
      x
        ? `${label}: **${Math.round(x.usedPct)}% ${s.used}**${x.resetsAt ? ` · ${s.resets} ${fmtReset(x.resetsAt)} (${s.inTime} ${fmtIn(x.resetsAt)})` : ''}`
        : `${label}: —`;
    lines.push(w(s.limit5h, p.fiveHour) + '  ');
    lines.push(w(s.limitWeek, p.weekly) + '  ');
    lines.push(`${s.lastPrompt}: ${money(p.periods.lastPrompt.usd, o)} · ${fmtTokens(p.periods.lastPrompt.tokens)} ${s.tokens}  `);
    lines.push(`${s.today}: ${money(p.periods.today.usd, o)} · ${fmtTokens(p.periods.today.tokens)} ${s.tokens}`);
    const err = errorText(p.limitsError);
    if (err) lines.push('', `_${err}_`);
    lines.push('', '---', '');
  }
  lines.push(`_${s.estimate}_`);
  return lines.join('\n');
}
