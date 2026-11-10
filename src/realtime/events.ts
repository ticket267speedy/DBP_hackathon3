import { useEffect, useLayoutEffect, useRef } from 'react';

export type LumonEventKind = 'refiner.updated' | 'refinement.created' | 'file.completed' | 'stream.reset';
export type LumonEvent = { kind: LumonEventKind; data: Record<string, unknown>; id?: number };

const events = new EventTarget();
export const floorOpened = new EventTarget();

export function notifyFloorOpened(): void {
  floorOpened.dispatchEvent(new Event('open'));
}

export function publishLumonEvent(event: LumonEvent): void {
  events.dispatchEvent(new CustomEvent<LumonEvent>('lumon', { detail: event }));
}

export function useLumonEvent(listener: (event: LumonEvent) => void): void {
  const latest = useRef(listener);
  useLayoutEffect(() => { latest.current = listener; }, [listener]);
  useEffect(() => {
    const receive = (event: Event) => latest.current((event as CustomEvent<LumonEvent>).detail);
    events.addEventListener('lumon', receive);
    return () => events.removeEventListener('lumon', receive);
  }, []);
}

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function jsonRecord(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string') return null;
  try {
    return record(JSON.parse(text));
  } catch {
    return null;
  }
}

