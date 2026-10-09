import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PromoStore } from './types.ts';

/**
 * Promo counters that survive a restart: a small JSON file, written atomically (temp file, then rename) a moment
 * after each change and again on process exit. No dependencies, any Node. For several server instances sharing
 * counters, implement PromoStore on Redis or a database instead.
 */
export class FilePromoStore implements PromoStore {
  private counts = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private dirty = false;

  constructor(
    private readonly path: string,
    private readonly debounceMs = 250,
  ) {
    this.load();
    process.once('exit', () => this.flush());
  }

  used(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  consume(key: string): void {
    this.counts.set(key, this.used(key) + 1);
    this.dirty = true;
    if (this.debounceMs <= 0) return this.flush();
    this.timer ??= setTimeout(() => this.flush(), this.debounceMs).unref();
  }

  /** Write pending changes now. */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.dirty) return;
    this.dirty = false;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.counts)));
    renameSync(tmp, this.path);
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, unknown>;
      for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) this.counts.set(k, v);
    } catch {
      // a damaged file starts the counters again; the next write replaces it
    }
  }
}
