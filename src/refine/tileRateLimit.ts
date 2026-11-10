import { abortError } from '../api/errors';
import { sleep } from '../lib/async';

interface Budget { sent: number[]; until: number }
const WINDOW = 10_000;
const LIMIT = 34;
let memory: Budget = { sent: [], until: 0 };
function storageKey(): string {
  try { return `lumon.tiles.${localStorage.getItem('lumon.sessionId') ?? 'session'}`; }
  catch { return 'lumon.tiles.session'; }
}
function read(): Budget {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey()) ?? 'null');
    if (saved && typeof saved === 'object' && 'sent' in saved && 'until' in saved && Array.isArray(saved.sent) && typeof saved.until === 'number') {
      return {sent: saved.sent.filter((v): v is number => typeof v === 'number'), until: saved.until};
    }
  } catch { /* Memory fallback when storage is unavailable. */ }
  return memory;
}
function write(value: Budget): void {
  memory = value;
  try { localStorage.setItem(storageKey(), JSON.stringify(value)); } catch { /* Memory fallback. */ }
}
async function locked<T>(task: () => T): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('lumon-tiles-budget', task);
  return task();
}
export async function pauseTileRequests(milliseconds: number): Promise<void> {
  await locked(() => { const budget = read(); budget.until = Math.max(budget.until, Date.now() + milliseconds); write(budget); });
}
export async function waitForTilePermit(signal: AbortSignal): Promise<void> {
  for (;;) {
    if (signal.aborted) throw abortError();
    const wait = await locked(() => {
      const now = Date.now();
      const budget = read();
      budget.sent = budget.sent.filter(time => now - time < WINDOW);
      const delay = Math.max(0, budget.until - now, budget.sent.length >= LIMIT ? budget.sent[0] + WINDOW - now + 20 : 0);
      if (delay === 0) budget.sent.push(now);
      write(budget);
      return delay;
    });
    if (!wait) return;
    await sleep(wait, signal);
  }
}
