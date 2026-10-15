import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';

/** Reads only the bytes appended to a JSONL file since the last call. */
export class JsonlTail {
  private offset = 0;
  private partial = '';
  constructor(public readonly file: string) {}

  /** Returns new complete lines. Resets if the file shrank (rewritten). */
  async readNew(): Promise<{ lines: string[]; reset: boolean }> {
    let reset = false;
    let size: number;
    try {
      size = (await fs.promises.stat(this.file)).size;
    } catch {
      return { lines: [], reset: false };
    }
    if (size < this.offset) {
      this.offset = 0;
      this.partial = '';
      reset = true;
    }
    if (size === this.offset) return { lines: [], reset };

    const fh = await fs.promises.open(this.file, 'r');
    const lines: string[] = [];
    try {
      const CHUNK = 8 * 1024 * 1024;
      while (this.offset < size) {
        const len = Math.min(CHUNK, size - this.offset);
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, this.offset);
        if (bytesRead <= 0) break;
        this.offset += bytesRead;
        const text = this.partial + buf.toString('utf8', 0, bytesRead);
        const parts = text.split('\n');
        this.partial = parts.pop() ?? '';
        for (const p of parts) if (p.trim()) lines.push(p);
      }
    } finally {
      await fh.close();
    }
    return { lines, reset };
  }
}

export function safeJson(line: string): any | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** Recursively lists *.jsonl files modified after `sinceMs`. */
export async function listJsonl(root: string, sinceMs: number, maxDepth = 4): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number) {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth) await walk(p, depth + 1);
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try {
          const st = await fs.promises.stat(p);
          if (st.mtimeMs >= sinceMs) out.push(p);
        } catch {
          /* ignore */
        }
      }
    }
  }
  await walk(root, 0);
  return out;
}

export interface HttpResult {
  status: number;
  body: string;
}

/** Minimal HTTPS GET using Node's https (respects VS Code's proxy patching). */
export function httpsGet(url: string, headers: Record<string, string> = {}, timeoutMs = 15000): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

export function toMs(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isNaN(n) && v.trim() !== '') return n < 1e12 ? n * 1000 : n;
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

export function startOfToday(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
