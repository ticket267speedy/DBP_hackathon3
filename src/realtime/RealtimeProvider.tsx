import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { ApiError, errorMessage } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { endSession } from '../auth/session';
import { API_BASE_URL } from '../config';
import { backoffDelay, newIdempotencyKey } from '../lib/async';
import { floorOpened, jsonRecord, publishLumonEvent, type LumonEventKind } from './events';

const eventKinds = [
  'refiner.updated', 'refinement.created', 'file.completed', 'stream.reset',
  'contingency.activated', 'contingency.resolved', 'session.revoked',
] as const;
type StreamEvent = { kind: typeof eventKinds[number]; data: Record<string, unknown>; id?: number };
type Contingency = { id: number; message: string };
type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'locked' | 'unavailable';
const streamLabels: Record<StreamStatus, string> = {
  connecting: 'Conectando avisos de Lumon…',
  open: 'Avisos de Lumon conectados',
  reconnecting: 'Reconectando avisos de Lumon…',
  locked: 'Avisos pendientes de la apertura del piso',
  unavailable: 'Avisos de Lumon no disponibles',
};

type WireMessage =
  | { type: 'event'; event: StreamEvent }
  | { type: 'hello'; sender: string }
  | { type: 'state'; to: string; active: Contingency[]; lastId: number | undefined; status: StreamStatus }
  | { type: 'status'; status: StreamStatus }
  | { type: 'resolved'; id: number }
  | { type: 'open' };

function sessionScope(userId: number, team: string): string {
  try {
    return localStorage.getItem('lumon.sessionId') ?? team + ':' + userId;
  } catch {
    return team + ':' + userId;
  }
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const userId = me?.id;
  const team = me?.team.code;
  const scope = me ? sessionScope(me.id, me.team.code) : null;
  const [queue, setQueue] = useState<Contingency[]>([]);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const ackBroadcast = useRef<(id: number) => void>(() => {});

  useEffect(() => {
    setQueue([]);
    if (userId === undefined || !scope) return;
    if (!API_BASE_URL || typeof BroadcastChannel === 'undefined' || !navigator.locks || typeof EventSource === 'undefined') {
      setStatus('unavailable');
      return;
    }
    setStatus('connecting');
    const channelName = 'lumon-events:' + scope;
    const channel = new BroadcastChannel(channelName);
    const sender = newIdempotencyKey();
    const lifetime = new AbortController();
    const seen = new Set<number>();
    const versions = new Map<number, number>();
    const active = new Map<number, Contingency>();
    const resolved = new Set<number>();
    let highestId: number | undefined;
    let resetId: number | undefined;
    let streamStatus: StreamStatus = 'connecting';
    const storageKey = channelName + ':resume';
    try {
      const saved = jsonRecord(sessionStorage.getItem(storageKey));
      if (typeof saved?.lastId === 'number') highestId = saved.lastId;
      if (Array.isArray(saved?.active)) {
        for (const value of saved.active as Contingency[]) active.set(value.id, value);
      }
    } catch { /* Algunos navegadores deshabilitan el almacenamiento. */ }
    let source: EventSource | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let openingTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let leader = false;
    let paused = false;
    let connecting = false;
    let releaseLeader: (() => void) | undefined;
    const persist = () => {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify({ lastId: highestId, active: Array.from(active.values()) }));
      } catch { /* La sesión puede continuar sin un cursor persistido. */ }
    };
    const sync = () => {
      setQueue(Array.from(active.values()));
      persist();
    };
    setQueue(Array.from(active.values()));
    const post = (message: WireMessage) => channel.postMessage(message);
    const report = (next: StreamStatus) => {
      streamStatus = next;
      setStatus(next);
      post({ type: 'status', status: next });
    };
    const resolve = (id: number) => {
      resolved.add(id);
      active.delete(id);
      sync();
    };
    ackBroadcast.current = (id) => {
      if (lifetime.signal.aborted) return;
      resolve(id);
      post({ type: 'resolved', id });
    };
    const receive = ({ kind, data, id }: StreamEvent) => {
      if (kind === 'stream.reset') {
        if (id !== undefined && id === resetId) return;
        resetId = id;
        seen.clear();
        versions.clear();
        highestId = id;
      }
      if (id !== undefined) {
        if (seen.has(id)) return;
        seen.add(id);
        if (seen.size > 2048) {
          const oldest = seen.values().next().value;
          if (oldest !== undefined) seen.delete(oldest);
        }
        highestId = Math.max(highestId ?? id, id);
        persist();
      }
      if (kind === 'refiner.updated' && typeof data.id === 'number' && typeof data.version === 'number') {
        if ((versions.get(data.id) ?? -1) >= data.version) return;
        versions.set(data.id, data.version);
      }
      if (kind === 'session.revoked') {
        // El cliente de sesión ya propaga el cierre a todas las pestañas.
        if (leader && sessionScope(userId, team ?? '') === scope) {
          endSession(data.reason === 'REFRESH_REUSED' ? 'REFRESH_REUSED' : 'SESSION_REVOKED');
        }
        return;
      }
      if (kind === 'contingency.activated') {
        if (data.userId === userId && typeof data.id === 'number' && typeof data.message === 'string' && !resolved.has(data.id)) {
          active.set(data.id, { id: data.id, message: data.message });
          sync();
        }
        return;
      }
      if (kind === 'contingency.resolved') {
        if (data.userId === userId && typeof data.id === 'number') resolve(data.id);
        return;
      }
      publishLumonEvent({ kind: kind satisfies LumonEventKind, data, id });
    };

    function disconnect() {
      source?.close();
      source = undefined;
      clearTimeout(openingTimer);
    }

    function schedule(minMs = 0) {
      if (lifetime.signal.aborted) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void connect(), Math.max(minMs, backoffDelay(attempt++, 3000, 30_000)));
    }

    async function connect() {
      if (lifetime.signal.aborted || !leader || source || connecting) return;
      connecting = true;
      try {
        const { ticket } = await api<{ ticket: string }>('/events/tickets', { method: 'POST', signal: lifetime.signal });
        if (lifetime.signal.aborted) return;
        paused = false;
        const params = new URLSearchParams({ ticket });
        if (highestId !== undefined) params.set('lastEventId', String(highestId));
        const current = new EventSource(API_BASE_URL + '/events/stream?' + params);
        source = current;
        let openedAt: number | undefined;
        const retry = () => {
          if (source !== current) return;
          if (openedAt !== undefined && Date.now() - openedAt > 30_000) attempt = 0;
          disconnect(); // El ticket de EventSource ya se consumió.
          report('reconnecting');
          schedule();
        };
        openingTimer = setTimeout(retry, 45_000);
        current.onopen = () => {
          clearTimeout(openingTimer);
          openedAt = Date.now();
          report('open');
          // EventSource solo expone eventos, no los comentarios : hb de un stream abierto.
        };
        current.onerror = retry;
        current.addEventListener('stream.superseded', retry);
        for (const kind of eventKinds) {
          current.addEventListener(kind, (raw) => {
            if (source !== current) return;
            const message = raw as MessageEvent<unknown>;
            const data = jsonRecord(message.data);
            if (!data) return;
            const parsed = Number(message.lastEventId);
            const id = message.lastEventId && Number.isSafeInteger(parsed) ? parsed : undefined;
            const event = { kind, data, id };
            post({ type: 'event', event });
            receive(event);
          });
        }
      } catch (error) {
        if (lifetime.signal.aborted) return;
        paused = error instanceof ApiError && error.status === 423;
        report(paused ? 'locked' : 'reconnecting');
        const retryAfter = error instanceof ApiError ? error.retryAfterMs ?? 0 : 0;
        schedule(Math.max(paused ? 30_000 : 0, retryAfter));
      } finally {
        connecting = false;
      }
    }

    function resumeFloor() {
      if (!leader || !paused) return;
      clearTimeout(retryTimer);
      void connect();
    }

    const openFloor = () => {
      post({ type: 'open' });
      resumeFloor();
    };
    floorOpened.addEventListener('open', openFloor);
    channel.onmessage = ({ data }: MessageEvent<WireMessage>) => {
      if (data.type === 'event') receive(data.event);
      if (data.type === 'resolved') resolve(data.id);
      if (data.type === 'open') resumeFloor();
      if (data.type === 'status') setStatus(data.status);
      if (data.type === 'hello' && leader) {
        post({ type: 'state', to: data.sender, active: Array.from(active.values()), lastId: highestId, status: streamStatus });
      }
      if (data.type === 'state' && data.to === sender) {
        setStatus(data.status);
        if (data.lastId !== undefined) highestId = Math.max(highestId ?? data.lastId, data.lastId);
        for (const entry of data.active) {
          if (!resolved.has(entry.id)) active.set(entry.id, entry);
        }
        sync();
      }
    };
    post({ type: 'hello', sender });
    void navigator.locks.request(channelName, { signal: lifetime.signal }, async () => {
      if (lifetime.signal.aborted) return;
      leader = true;
      void connect();
      await new Promise<void>((release) => { releaseLeader = release; });
    }).catch(() => { /* Solicitud de lock cancelada al desmontar. */ });

    return () => {
      lifetime.abort();
      disconnect();
      clearTimeout(retryTimer);
      releaseLeader?.();
      floorOpened.removeEventListener('open', openFloor);
      channel.close();
    };
  }, [scope, team, userId]);

  return (
    <>
      {children}
      <p className="mx-auto max-w-7xl px-4 pb-3 text-xs text-[var(--mdr-muted)]" role="status">{streamLabels[status]}</p>
      {queue[0] && <ContingencyDialog key={scope + ':' + queue[0].id} value={queue[0]} onResolved={(id) => ackBroadcast.current(id)} />}
    </>
  );
}

function ContingencyDialog({ value, onResolved }: { value: Contingency; onResolved: (id: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const previousFocus = document.activeElement;
    const current = dialog.current;
    current?.showModal();
    return () => {
      controller.current?.abort();
      current?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  async function confirm() {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setSending(true);
    setError('');
    try {
      await api<void>('/contingency/' + value.id + '/ack', { method: 'POST', signal: request.signal, retries: 2 });
      if (!request.signal.aborted) onResolved(value.id);
    } catch (error) {
      if (!request.signal.aborted) setError(errorMessage(error));
    } finally {
      if (!request.signal.aborted) {
        setSending(false);
        controller.current = null;
      }
    }
  }

  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="contingency-title"
      aria-describedby="contingency-message"
      className="mdr-panel m-auto w-[min(92vw,30rem)] space-y-4 backdrop:bg-black/80"
      onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          event.preventDefault();
          dialog.current?.querySelector('button')?.focus();
        }
      }}
    >
      <h2 id="contingency-title" className="text-xl font-semibold">Contingencia activa</h2>
      <p id="contingency-message">{value.message}</p>
      <p role="status">{error}</p>
      <button type="button" aria-disabled={sending} className="mdr-btn" onClick={() => void confirm()}>
        {sending ? 'Confirmando…' : 'Confirmar recepción'}
      </button>
    </dialog>
  );
}

