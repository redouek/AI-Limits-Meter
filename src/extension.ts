import * as vscode from 'vscode';
import { ClaudeCollector } from './claude';
import { CodexCollector } from './codex';
import { Fx } from './fx';
import { MeterView } from './view';
import { setCustomPrices } from './pricing';
import { renderAll, statusText, statusTooltip, minRemaining, RenderOpts, CurrencyMode } from './render';
import { strings } from './i18n';
import { ProviderSnapshot } from './model';

const NOTIFIED_KEY = 'aiLimitsMeter.notified';

export function activate(ctx: vscode.ExtensionContext) {
  const claude = new ClaudeCollector();
  const codex = new CodexCollector();
  const fx = new Fx(ctx.globalState);
  const cfg = () => vscode.workspace.getConfiguration('aiLimitsMeter');

  // One status bar item per tool, so each can be shown/hidden or moved on its own.
  const mkStatus = (id: 'claude' | 'codex', prio: number) => {
    const it = vscode.window.createStatusBarItem(`aiLimitsMeter.status.${id}`, vscode.StatusBarAlignment.Right, prio);
    it.name = id === 'claude' ? 'AI Limits: Claude Code' : 'AI Limits: Codex';
    it.command = `aiLimitsMeter.focus.${id}`;
    ctx.subscriptions.push(it);
    return it;
  };
  const statusItems = { claude: mkStatus('claude', 1001), codex: mkStatus('codex', 1000) };

  let busy = false;
  let timer: NodeJS.Timeout | undefined;

  // Two independent panels: each can be dragged to wherever suits that tool.
  const views = {
    claude: new MeterView('aiLimitsMeter.claude', () => tick(false)),
    codex: new MeterView('aiLimitsMeter.codex', () => tick(false)),
  };
  for (const v of Object.values(views)) ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(v.id, v));

  async function tick(forceApi: boolean) {
    if (busy) return;
    busy = true;
    try {
      const c = cfg();
      setCustomPrices(c.get('customPrices'));
      const want = c.get<string[]>('providers', ['claude', 'codex']);
      const jobs: Promise<unknown>[] = [fx.ensure()];
      if (want.includes('claude')) {
        jobs.push(claude.scanLogs().then(() => claude.refreshLimits(Math.max(60, c.get<number>('apiPollSeconds', 120)) * 1000, forceApi)));
      }
      if (want.includes('codex')) jobs.push(codex.scanLogs());
      await Promise.allSettled(jobs);

      const snaps: ProviderSnapshot[] = [];
      if (want.includes('claude')) snaps.push(claude.snapshot());
      if (want.includes('codex')) snaps.push(codex.snapshot());
      const shown = snaps.filter((s) => s.available);
      vscode.commands.executeCommand('setContext', 'aiLimitsMeter.showClaude', want.includes('claude'));
      vscode.commands.executeCommand('setContext', 'aiLimitsMeter.showCodex', want.includes('codex'));

      const opts: RenderOpts = {
        currency: c.get<CurrencyMode>('currency', 'both'),
        fx: fx.current(),
        barColor: c.get<string>('barColor', '#F5C518'),
      };
      const mode = c.get<string>('statusBar', 'limitsAndCost');

      for (const id of ['claude', 'codex'] as const) {
        const snap = shown.find((p) => p.id === id);
        views[id].update(
          snap
            ? renderAll([snap], opts)
            : `<div class="dim pad">${id === 'claude' ? 'Claude Code' : 'Codex'}: ${strings().notInstalled}</div>`,
          opts.barColor
        );

        const item = statusItems[id];
        if (mode === 'off' || !snap) {
          item.hide();
          continue;
        }
        item.text = statusText([snap], opts, mode === 'limitsAndCost');
        const md = new vscode.MarkdownString(statusTooltip([snap], opts));
        md.supportThemeIcons = true;
        item.tooltip = md;
        const used = 100 - minRemaining([snap]);
        item.backgroundColor =
          used >= 92
            ? new vscode.ThemeColor('statusBarItem.errorBackground')
            : used >= 80
              ? new vscode.ThemeColor('statusBarItem.warningBackground')
              : undefined;
        item.show();
      }
      notify(shown);
    } catch (e) {
      console.error('[ai-limits-meter]', e);
    } finally {
      busy = false;
    }
  }

  function notify(snaps: ProviderSnapshot[]) {
    const ths = (cfg().get<number[]>('warnAtPercentUsed', [80, 95]) ?? []).filter((n) => n > 0 && n <= 100).sort((a, b) => b - a);
    if (!ths.length) return;
    const s = strings();
    const done = new Set(ctx.globalState.get<string[]>(NOTIFIED_KEY, []));
    let changed = false;
    for (const p of snaps) {
      for (const [w, label] of [
        [p.fiveHour, s.limit5h],
        [p.weekly, s.limitWeek],
      ] as const) {
        if (!w?.resetsAt) continue;
        const hit = ths.find((t) => w.usedPct >= t);
        if (hit === undefined) continue;
        const key = `${p.id}:${label}:${Math.round(w.resetsAt / 60000)}:${hit}`;
        if (done.has(key)) continue;
        done.add(key);
        changed = true;
        const msg = s.warn(p.id === 'claude' ? 'Claude Code' : 'Codex', label.toLowerCase(), Math.round(w.usedPct));
        (hit >= 95 ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(msg);
      }
    }
    if (changed) ctx.globalState.update(NOTIFIED_KEY, [...done].slice(-200));
  }

  function schedule() {
    if (timer) clearInterval(timer);
    const secs = Math.max(3, cfg().get<number>('logPollSeconds', 10));
    timer = setInterval(() => tick(false), secs * 1000);
  }

  ctx.subscriptions.push(
    vscode.commands.registerCommand('aiLimitsMeter.refresh', () => tick(true)),
    vscode.commands.registerCommand('aiLimitsMeter.focus.claude', () => vscode.commands.executeCommand('aiLimitsMeter.claude.focus')),
    vscode.commands.registerCommand('aiLimitsMeter.focus.codex', () => vscode.commands.executeCommand('aiLimitsMeter.codex.focus')),
    vscode.commands.registerCommand('aiLimitsMeter.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:renatodouek.ai-limits-meter')
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiLimitsMeter')) {
        schedule();
        tick(false);
      }
    }),
    vscode.window.onDidChangeWindowState((w) => w.focused && tick(false)),
    { dispose: () => timer && clearInterval(timer) }
  );

  schedule();
  tick(true);
}

export function deactivate() {}
