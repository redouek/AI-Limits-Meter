import * as vscode from 'vscode';

export class MeterView implements vscode.WebviewViewProvider {
  public static readonly id = 'aiLimitsMeter.view';
  private view?: vscode.WebviewView;
  private lastHtml = '';

  constructor(private onVisible: () => void) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = shell(nonce());
    view.webview.onDidReceiveMessage((m) => {
      if (m?.type === 'ready' && this.lastHtml) view.webview.postMessage({ type: 'update', html: this.lastHtml });
      if (m?.type === 'refresh') vscode.commands.executeCommand('aiLimitsMeter.refresh');
    });
    view.onDidChangeVisibility(() => view.visible && this.onVisible());
    this.onVisible();
  }

  get visible(): boolean {
    return !!this.view?.visible;
  }

  update(html: string, barColor: string): void {
    this.lastHtml = html;
    this.view?.webview.postMessage({ type: 'update', html, barColor });
  }
}

function nonce(): string {
  let s = '';
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += c.charAt(Math.floor(Math.random() * c.length));
  return s;
}

function shell(n: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root { --track: color-mix(in srgb, var(--vscode-foreground) 10%, transparent); }
  body { margin: 0; padding: 6px 10px 10px; font-family: var(--vscode-font-family); font-size: 12px;
         color: var(--vscode-foreground); background: transparent; }
  .mono, .meta, .num, .upd, footer { font-family: var(--vscode-editor-font-family), monospace; }
  .prov { border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, #3333));
          border-radius: 8px; padding: 8px 10px; margin-bottom: 8px;
          background: color-mix(in srgb, var(--vscode-editorWidget-background, #1e1e1e) 60%, transparent); }
  header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .name { font-weight: 600; letter-spacing: .2px; }
  .plan { font-size: 10px; text-transform: uppercase; padding: 0 5px; border-radius: 4px;
          border: 1px solid currentColor; opacity: .6; }
  .upd { margin-left: auto; opacity: .55; font-size: 11px; cursor: pointer; }
  .toggle { background: none; border: 0; color: inherit; cursor: pointer; padding: 0; width: 14px;
            font-size: 11px; opacity: .7; transition: transform .15s; }
  .prov.collapsed .toggle { transform: rotate(-90deg); }
  .prov.collapsed .more { display: none; }
  #root { container-type: inline-size; }
  .row { display: grid; grid-template-columns: 100px minmax(80px, 1fr) 31ch; grid-template-areas: "lbl bar meta";
         align-items: center; column-gap: 10px; margin: 4px 0; }
  .row .lbl { grid-area: lbl; } .row .bar { grid-area: bar; } .row .meta { grid-area: meta; text-align: right; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  @container (max-width: 470px) {
    .row { grid-template-columns: 1fr auto; grid-template-areas: "lbl meta" "bar bar"; row-gap: 3px; margin: 6px 0; }
    .row .w { display: none; }
  }
  .lbl { white-space: nowrap; font-weight: 600; }
  .bar { height: 10px; border-radius: 2px; background: var(--track); overflow: hidden; position: relative; }
  .bar .fill { height: 100%; transition: width .4s ease; }
  /* thin vertical gaps, like a segmented meter */
  .bar::after { content: ''; position: absolute; inset: 0;
    background: repeating-linear-gradient(90deg, transparent 0 3px, rgba(0,0,0,.28) 3px 4px); }
  .meta { white-space: nowrap; font-size: 11px; opacity: .9; }
  .meta b { font-weight: 600; }
  .warn { margin-top: 4px; font-size: 11px; color: var(--vscode-editorWarning-foreground); }
  .more { margin-top: 6px; }
  .line { font-size: 11px; opacity: .85; margin: 4px 0 6px; }
  .line b { font-family: var(--vscode-editor-font-family), monospace; font-weight: 600; }
  .sep { opacity: .5; margin: 0 2px; }
  table.costs { width: 100%; border-collapse: collapse; font-size: 11px; }
  .costs th { text-align: right; font-weight: 500; opacity: .55; padding: 0 0 2px 8px; }
  .costs td { padding: 2px 0 2px 8px; border-top: 1px solid var(--track); }
  .costs td.lbl { padding-left: 0; font-weight: 500; }
  .num { text-align: right; white-space: nowrap; }
  .dim { opacity: .6; }
  .pad { padding: 8px 0; }
  footer { display: flex; flex-direction: column; gap: 2px; font-size: 10px; opacity: .5; }
</style></head>
<body><div id="root" class="dim pad">…</div>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const st = vscode.getState() || { collapsed: {} };
  const root = document.getElementById('root');
  function apply() {
    document.querySelectorAll('.prov').forEach(el => el.classList.toggle('collapsed', !!st.collapsed[el.dataset.id]));
  }
  window.addEventListener('message', e => {
    if (e.data && e.data.type === 'update') { root.className = ''; root.innerHTML = e.data.html; apply(); }
  });
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-toggle]');
    if (t) { const id = t.dataset.toggle; st.collapsed[id] = !st.collapsed[id]; vscode.setState(st); apply(); return; }
    if (e.target.closest('.upd')) vscode.postMessage({ type: 'refresh' });
  });
  vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}
