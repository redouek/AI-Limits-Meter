/**
 * API list prices in USD per 1M tokens. Subscription plans (Pro/Max, ChatGPT Plus/Pro)
 * are not billed per token — these values show the *API-equivalent* cost.
 *
 * Sources (checked Oct 2026):
 *  - https://platform.claude.com/docs/en/about-claude/pricing
 *  - https://developers.openai.com/api/docs/pricing
 * Users can override/add models with the `aiLimitsMeter.customPrices` setting.
 */

export interface Price {
  input: number;
  output: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  cacheRead: number;
  /** Optional higher tier applied when the whole prompt exceeds `tierThreshold` tokens. */
  tierThreshold?: number;
  tier?: Omit<Price, 'tierThreshold' | 'tier'>;
}

const p = (input: number, output: number, cw5: number, cw1h: number, cr: number): Price => ({
  input,
  output,
  cacheWrite5m: cw5,
  cacheWrite1h: cw1h,
  cacheRead: cr,
});

/** Ordered: the first prefix that matches the model id wins (more specific first). */
export const CLAUDE_PRICES: [string, Price][] = [
  ['claude-fable-5-1', p(10, 50, 12.5, 20, 0.25)],
  ['claude-mythos-5-1', p(10, 50, 12.5, 20, 0.25)],
  ['claude-fable-5', p(10, 50, 12.5, 20, 1)],
  ['claude-mythos', p(10, 50, 12.5, 20, 1)],
  ['claude-opus-5-5', p(4, 20, 5, 8, 0.2)],
  ['claude-sonnet-5-5', p(2, 10, 2.5, 4, 0.1)],
  [
    'claude-haiku-5-5',
    { ...p(0.1, 0.5, 0.125, 0.2, 0.01), tierThreshold: 100_000, tier: p(0.5, 2.5, 0.625, 1, 0.05) },
  ],
  ['claude-opus-5', p(5, 25, 6.25, 10, 0.5)],
  ['claude-sonnet-5', p(2, 10, 2.5, 4, 0.2)],
  ['claude-opus-4-8', p(5, 25, 6.25, 10, 0.5)],
  ['claude-opus-4-7', p(5, 25, 6.25, 10, 0.5)],
  ['claude-opus-4-6', p(5, 25, 6.25, 10, 0.5)],
  ['claude-opus-4-5', p(5, 25, 6.25, 10, 0.5)],
  ['claude-opus-4', p(15, 75, 18.75, 30, 1.5)],
  ['claude-sonnet-4', p(3, 15, 3.75, 6, 0.3)],
  ['claude-haiku-4-5', p(1, 5, 1.25, 2, 0.1)],
  ['claude-3-5-haiku', p(0.8, 4, 1, 1.6, 0.08)],
  ['claude-haiku-3-5', p(0.8, 4, 1, 1.6, 0.08)],
];

export const OPENAI_PRICES: [string, Price][] = [
  ['gpt-5.5-pro', { input: 30, output: 180, cacheRead: 30 }],
  ['gpt-5.5', { input: 5, output: 30, cacheRead: 0.5 }],
  ['gpt-5.4-mini', { input: 0.75, output: 4.5, cacheRead: 0.075 }],
  ['gpt-5.4', { input: 2.5, output: 15, cacheRead: 0.25 }],
  ['gpt-5.3', { input: 1.75, output: 14, cacheRead: 0.175 }],
  ['gpt-5.2', { input: 1.75, output: 14, cacheRead: 0.175 }],
  ['gpt-5.1-codex-mini', { input: 0.25, output: 2, cacheRead: 0.025 }],
  ['gpt-5-codex-mini', { input: 0.25, output: 2, cacheRead: 0.025 }],
  ['gpt-5.1', { input: 1.25, output: 10, cacheRead: 0.125 }],
  ['gpt-5-mini', { input: 0.25, output: 2, cacheRead: 0.025 }],
  ['gpt-5', { input: 1.25, output: 10, cacheRead: 0.125 }],
];

/** Used when a model is unknown — cost is then flagged as an estimate. */
const CLAUDE_FALLBACK = 'claude-opus-5-5';
const OPENAI_FALLBACK = 'gpt-5.5';

let custom: Record<string, Partial<Price>> = {};
export function setCustomPrices(c: Record<string, Partial<Price>> | undefined) {
  custom = c ?? {};
}

export function findPrice(model: string, table: [string, Price][], fallbackId: string): { price: Price; known: boolean } {
  const id = (model || '').toLowerCase();
  for (const [k, v] of Object.entries(custom)) {
    if (id.startsWith(k.toLowerCase())) {
      const base = table.find(([kk]) => id.startsWith(kk))?.[1] ?? table.find(([kk]) => kk === fallbackId)![1];
      return { price: { ...base, ...v } as Price, known: true };
    }
  }
  const hit = table.find(([k]) => id.startsWith(k));
  if (hit) return { price: hit[1], known: true };
  return { price: table.find(([k]) => k === fallbackId)![1], known: false };
}

export interface ClaudeUsage {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export function claudeCost(model: string, u: ClaudeUsage, fast = false): { usd: number; known: boolean } {
  const { price, known } = findPrice(model, CLAUDE_PRICES, CLAUDE_FALLBACK);
  let pr: Omit<Price, 'tier' | 'tierThreshold'> = price;
  const prompt = u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
  if (price.tier && price.tierThreshold && prompt > price.tierThreshold) pr = price.tier;
  // Fast mode doubles input/output price on Opus 5.5 (and 2x on Opus 5/4.8); caching multipliers stack.
  const m = fast ? 2 : 1;
  const usd =
    (u.input * pr.input * m +
      u.output * pr.output * m +
      u.cacheWrite5m * (pr.cacheWrite5m ?? pr.input * 1.25) * m +
      u.cacheWrite1h * (pr.cacheWrite1h ?? pr.input * 2) * m +
      u.cacheRead * pr.cacheRead * m) /
    1e6;
  return { usd, known };
}

export interface OpenAIUsage {
  /** Total input tokens, INCLUDING cached ones (OpenAI convention). */
  input: number;
  cached: number;
  /** Output tokens (already includes reasoning tokens). */
  output: number;
}

export function openaiCost(model: string, u: OpenAIUsage): { usd: number; known: boolean } {
  const { price, known } = findPrice(model, OPENAI_PRICES, OPENAI_FALLBACK);
  const uncached = Math.max(0, u.input - u.cached);
  const usd = (uncached * price.input + u.cached * price.cacheRead + u.output * price.output) / 1e6;
  return { usd, known };
}
