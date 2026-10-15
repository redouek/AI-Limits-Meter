import * as vscode from 'vscode';

const pt = {
  limit5h: 'Limite 5h',
  limitWeek: 'Limite semanal',
  left: 'restante',
  used: 'usado',
  resets: 'renova',
  inTime: 'em',
  renewed: 'renovado',
  lastPrompt: 'Último prompt',
  session: 'Sessão atual',
  window5h: 'Janela 5h',
  last5h: 'Últimas 5h',
  today: 'Hoje',
  week: 'Semana',
  last7d: 'Últimos 7 dias',
  tokens: 'tokens',
  updated: 'atualizado',
  noData: 'Sem dados ainda',
  estimate: 'Custo equivalente à API (o plano por assinatura não cobra por token).',
  estimatedModel: 'Modelo sem preço na tabela — valor estimado.',
  fx: 'Cotação',
  input: 'entrada',
  output: 'saída',
  cacheWrite: 'cache (escrita)',
  cacheRead: 'cache (leitura)',
  calls: 'chamadas',
  refresh: 'Atualizar',
  settings: 'Configurações',
  err_noCredentials: 'Faça login no Claude Code para ver os limites.',
  err_tokenExpired: 'Sessão do Claude Code expirou — envie um prompt no Claude Code para renová-la.',
  err_rateLimited: 'Servidor pediu uma pausa; tentando de novo em instantes.',
  err_network: 'Sem conexão com a Anthropic.',
  err_noCodexData: 'Os limites aparecem após o primeiro prompt no Codex.',
  err_http: 'Resposta inesperada da Anthropic',
  limitsFromLogs: 'limites lidos do último prompt',
  warn: (who: string, win: string, pct: number) => `${who}: você já usou ${pct}% do ${win}.`,
  notInstalled: 'não encontrado neste computador',
};

type Strings = typeof pt;

const en: Strings = {
  limit5h: '5h limit',
  limitWeek: 'Weekly limit',
  left: 'left',
  used: 'used',
  resets: 'resets',
  inTime: 'in',
  renewed: 'renewed',
  lastPrompt: 'Last prompt',
  session: 'Current session',
  window5h: '5h window',
  last5h: 'Last 5h',
  today: 'Today',
  week: 'Week',
  last7d: 'Last 7 days',
  tokens: 'tokens',
  updated: 'updated',
  noData: 'No data yet',
  estimate: 'API-equivalent cost (subscription plans are not billed per token).',
  estimatedModel: 'Model not in the price table — estimated value.',
  fx: 'Rate',
  input: 'input',
  output: 'output',
  cacheWrite: 'cache write',
  cacheRead: 'cache read',
  calls: 'calls',
  refresh: 'Refresh',
  settings: 'Settings',
  err_noCredentials: 'Sign in to Claude Code to see limits.',
  err_tokenExpired: 'Claude Code session expired — send a prompt in Claude Code to renew it.',
  err_rateLimited: 'Server asked to slow down; retrying shortly.',
  err_network: 'Cannot reach Anthropic.',
  err_noCodexData: 'Limits show up after your first Codex prompt.',
  err_http: 'Unexpected response from Anthropic',
  limitsFromLogs: 'limits read from the last prompt',
  warn: (who: string, win: string, pct: number) => `${who}: you have used ${pct}% of the ${win}.`,
  notInstalled: 'not found on this computer',
};

export function strings(): Strings {
  return locale().startsWith('pt') ? pt : en;
}

export function locale(): string {
  const forced = vscode.workspace.getConfiguration('aiLimitsMeter').get<string>('language', 'auto');
  if (forced && forced !== 'auto') return forced;
  return (vscode.env.language || 'en').toLowerCase();
}

export function errorText(code?: string): string | undefined {
  if (!code) return undefined;
  const s = strings() as any;
  if (code.startsWith('http')) return `${s.err_http} (${code.slice(4)})`;
  return s['err_' + code] ?? code;
}
