import { MOCK } from "./env.ts";

/**
 * En modo simulado las esperas se aceleran para que la prueba sea rápida,
 * pero los tiempos reportados se escalan de vuelta para que sean coherentes entre sí.
 */
const SPEEDUP = MOCK ? 50 : 1;

export function now(): number {
  return performance.now() * SPEEDUP;
}

export async function simulateLatency(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms / SPEEDUP));
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m} min ${s.toString().padStart(2, "0")} s`;
}

export function fmtUsd(usd: number): string {
  if (usd === 0) return "$0";
  // Montos muy chicos (Jev) con dos cifras significativas, sin notación científica.
  if (usd < 0.01) return `$${usd.toFixed(Math.min(10, 1 - Math.floor(Math.log10(usd))))}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
