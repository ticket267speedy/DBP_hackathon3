import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { ApiError } from '../api/errors';
import type { CellRef } from '../api/types';
import { WS_BASE_URL } from '../config';
import { backoffDelay, newIdempotencyKey } from '../lib/async';
import { floorOpened, jsonRecord } from './events';

export interface FloorMember {
  userId: number;
  displayName: string;
  r: number | null;
  c: number | null;
}

export interface FloorClaim {
  claimId: string;
  userId: number;
  displayName: string;
  cells: CellRef[];
  expiresAt: string;
}

type FloorStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';
interface FloorState {
  status: FloorStatus;
  message: string;
  members: FloorMember[];
  claims: FloorClaim[];
  claimMessage: string;
}

type FloorAction = { type: 'cursor'; cell: CellRef } | { type: 'selection'; cell: CellRef | null };

const empty = (status: FloorStatus, message = ''): FloorState => ({
  status, message, members: [], claims: [], claimMessage: '',
});

const terminalClose: Partial<Record<number, string>> = {
  4400: 'El servidor rechazó un mensaje del piso compartido.',
  4403: 'El piso compartido rechazó la conexión.',
  4404: 'El archivo ya no está disponible en el piso compartido.',
  4423: 'El piso de pruebas está cerrado.',
};

function merge<T>(items: T[], value: T, same: (a: T, b: T) => boolean): T[] {
  return [...items.filter((item) => !same(item, value)), value];
}

const sameUser = (a: FloorMember, b: FloorMember) => a.userId === b.userId;
const sameClaim = (a: FloorClaim, b: FloorClaim) => a.claimId === b.claimId;

export function useFloor(fileId: number, enabled: boolean) {
  const [state, setState] = useState<FloorState>(() => empty('connecting'));
  const dispatch = useRef<(action: FloorAction) => void>(() => {});
  const target = useRef<CellRef | null>(null);
  const position = useRef<CellRef | null>(null);
  const select = useCallback((cell: CellRef | null) => {
    target.current = cell;
    dispatch.current({ type: 'selection', cell });
  }, []);
  const cursor = useCallback((cell: CellRef) => {
    if (position.current?.r === cell.r && position.current.c === cell.c) return;
    position.current = cell;
    dispatch.current({ type: 'cursor', cell });
  }, []);

  useEffect(() => {
    if (!enabled || !WS_BASE_URL) {
      setState(empty('closed', 'Piso compartido no disponible.'));
      return;
    }
    const lifetime = new AbortController();
    let socket: WebSocket | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cursorTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let renewTimer: ReturnType<typeof setInterval> | undefined;
    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    let lastCursor = 0;
    let lastPong = 0;
    let latestPing: number | undefined;
    let retryCount = 0;
    let invalidTicket = false;
    let clearanceBlocked = false;
    let connecting = false;
    let seq: number | undefined;
    let resync = false;
    let claimId: string | undefined;
    let requestId: string | undefined;

    function send(message: Record<string, unknown>): boolean {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    }

    function sendCursor() {
      clearTimeout(cursorTimer);
      if (document.hidden || seq === undefined || !position.current) return;
      const wait = 110 - (performance.now() - lastCursor);
      if (wait > 0) {
        cursorTimer = setTimeout(sendCursor, wait);
      } else if (send({ type: 'cursor', ...position.current })) {
        lastCursor = performance.now();
      }
    }

    function requestClaim(cell: CellRef | null) {
      clearTimeout(requestTimer);
      if (claimId) send({ type: 'release', claimId });
      claimId = undefined;
      requestId = undefined;
      setState((prev) => ({ ...prev, claimMessage: '' }));
      if (!cell || seq === undefined) return;
      const id = newIdempotencyKey();
      if (send({ type: 'claim', requestId: id, ...cell })) {
        requestId = id;
        setState((prev) => ({ ...prev, claimMessage: 'Solicitando la reserva…' }));
        requestTimer = setTimeout(() => {
          if (requestId !== id) return;
          requestId = undefined;
          setState((prev) => ({ ...prev, claimMessage: 'No llegó la reserva. Puedes volver a seleccionar el grupo.' }));
        }, 7000);
      }
    }

    dispatch.current = (action) => {
      if (action.type === 'cursor') sendCursor();
      else requestClaim(action.cell);
    };

    function stopTimers() {
      clearTimeout(cursorTimer);
      clearTimeout(requestTimer);
      clearInterval(pingTimer);
      clearInterval(renewTimer);
    }

    function reconnect(minimum = 0) {
      setState(empty('reconnecting', 'Reconectando al piso compartido…'));
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void connect(), Math.max(minimum, backoffDelay(retryCount++, 1000)));
    }

    function receive(message: Record<string, unknown>) {
      const { type } = message;
      if (type === 'snapshot' && typeof message.seq === 'number' && Array.isArray(message.members) && Array.isArray(message.claims)) {
        const wasInitial = seq === undefined;
        const claims = message.claims as FloorClaim[];
        seq = message.seq;
        resync = false;
        if (claimId && !claims.some((claim) => claim.claimId === claimId)) claimId = undefined;
        setState((prev) => ({
          ...prev, status: 'connected', message: '', members: message.members as FloorMember[], claims,
        }));
        if (wasInitial) {
          sendCursor();
          requestClaim(target.current);
        }
        return;
      }

      if (type === 'pong' && message.t === latestPing) {
        lastPong = Date.now();
        return;
      }
      if (type === 'claim.denied' && requestId && message.requestId === requestId) {
        requestId = undefined;
        clearTimeout(requestTimer);
        const holder = message.holder as { displayName?: unknown } | null;
        const text = message.reason === 'HELD'
          ? `${typeof holder?.displayName === 'string' ? holder.displayName : 'Otro refinador'} tiene la reserva.`
          : 'La celda ya no pertenece a un grupo disponible.';
        setState((prev) => ({ ...prev, claimMessage: text }));
        return;
      }
      if (type === 'claim.granted' && typeof message.claimId === 'string') {
        if (requestId && message.requestId === requestId) {
          claimId = message.claimId;
          requestId = undefined;
          clearTimeout(requestTimer);
          setState((prev) => ({ ...prev, claimMessage: 'Reserva activa mientras el grupo siga seleccionado.' }));
        } else if (claimId !== message.claimId) {
          send({ type: 'release', claimId: message.claimId });
        }
      }
      if (type === 'claim.released' && claimId && message.claimId === claimId) {
        claimId = undefined;
        setState((prev) => ({ ...prev, claimMessage: 'Se liberó la reserva.' }));
      }

      if (typeof message.seq === 'number') {
        if (resync || seq === undefined || message.seq <= seq) return;
        if (message.seq !== seq + 1) {
          resync = true;
          send({ type: 'resync' });
          return;
        }
        seq = message.seq;
      }

      if (type === 'cursor' && typeof message.userId === 'number') {
        const { r, c } = message;
        if (typeof r === 'number' && typeof c === 'number') {
          setState((prev) => ({
            ...prev, members: prev.members.map((member) => member.userId === message.userId ? { ...member, r, c } : member),
          }));
        }
      } else if (type === 'member.joined' && typeof message.userId === 'number' && typeof message.displayName === 'string') {
        const member: FloorMember = { userId: message.userId, displayName: message.displayName, r: null, c: null };
        setState((prev) => ({ ...prev, members: merge(prev.members, member, sameUser) }));
      } else if (type === 'member.left') {
        setState((prev) => ({ ...prev, members: prev.members.filter((member) => member.userId !== message.userId) }));
      } else if (type === 'claim.granted' || type === 'claim.updated') {
        const claim = message as unknown as FloorClaim;
        setState((prev) => ({ ...prev, claims: merge(prev.claims, claim, sameClaim) }));
      } else if (type === 'claim.released') {
        setState((prev) => ({ ...prev, claims: prev.claims.filter((claim) => claim.claimId !== message.claimId) }));
      }
    }

    async function connect() {
      if (lifetime.signal.aborted || socket || connecting) return;
      connecting = true;
      try {
        const { ticket } = await api<{ ticket: string }>('/floor/tickets', {
          method: 'POST', body: { fileId }, signal: lifetime.signal,
        });
        if (lifetime.signal.aborted) return;
        const current = new WebSocket(WS_BASE_URL + '/floor/ws?' + new URLSearchParams({ ticket }));
        socket = current;
        current.onopen = () => {
          lastPong = Date.now();
          function ping() {
            if (Date.now() - lastPong > 29_000) {
              current.close(4000, 'Sin respuesta al latido');
              return;
            }
            latestPing = Date.now();
            send({ type: 'ping', t: latestPing });
          }
          ping();
          pingTimer = setInterval(ping, 10_000);
          renewTimer = setInterval(() => {
            if (claimId) send({ type: 'renew', claimId });
          }, 6500);
        };
        current.onmessage = ({ data }: MessageEvent<unknown>) => {
          if (lifetime.signal.aborted || socket !== current) return;
          const message = jsonRecord(data);
          if (!message) return;
          if (message.type === 'snapshot') {
            retryCount = 0;
            invalidTicket = false;
          }
          receive(message);
        };
        current.onclose = ({ code, reason }) => {
          if (socket !== current) return;
          stopTimers();
          socket = undefined;
          seq = undefined;
          resync = false;
          claimId = undefined;
          requestId = undefined;
          if (lifetime.signal.aborted) return;
          const terminal = terminalClose[code];
          if (terminal) {
            clearanceBlocked = code === 4423;
            setState(empty('closed', terminal));
          } else if (code === 4401) {
            if (invalidTicket || reason === 'TOKEN_IN_URL_FORBIDDEN') {
              setState(empty('closed', 'El servidor rechazó el ticket del piso compartido.'));
              return;
            }
            invalidTicket = true;
            reconnect();
          } else {
            reconnect(code === 4429 ? 10_000 : 0);
          }
        };
      } catch (error) {
        if (lifetime.signal.aborted) return;
        if (error instanceof ApiError && [400, 401, 403, 404, 423].includes(error.status)) {
          clearanceBlocked = error.status === 423;
          setState(empty('closed', clearanceBlocked ? 'El piso de pruebas está cerrado.' : error.message));
        } else {
          reconnect(error instanceof ApiError ? error.retryAfterMs ?? 0 : 0);
        }
      } finally {
        connecting = false;
      }
    }

    function resumeFloor() {
      if (!clearanceBlocked) return;
      clearanceBlocked = false;
      setState(empty('connecting'));
      void connect();
    }

    document.addEventListener('visibilitychange', sendCursor);
    floorOpened.addEventListener('open', resumeFloor);
    setState(empty('connecting'));
    void connect();
    return () => {
      lifetime.abort();
      clearTimeout(retryTimer);
      stopTimers();
      document.removeEventListener('visibilitychange', sendCursor);
      floorOpened.removeEventListener('open', resumeFloor);
      if (claimId) send({ type: 'release', claimId });
      dispatch.current = () => {};
      socket?.close();
    };
  }, [enabled, fileId]);

  return { ...state, select, cursor };
}

