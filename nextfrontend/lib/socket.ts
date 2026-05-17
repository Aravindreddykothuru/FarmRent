/**
 * lib/socket.ts — Singleton Socket.IO clients for FarmRent
 *
 * The backend exposes two namespaces:
 *   /tracking     — GPS, booking rooms, booking-level chat messages
 *   /notifications — per-user notification push
 *
 * Root namespace is kept for legacy use only.
 */
import { io, Socket } from 'socket.io-client';

function getSocketUrl(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (typeof window !== 'undefined') return window.location.origin;
  return (process.env.INTERNAL_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

const SOCKET_OPTS = {
    autoConnect: false,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
} as const;

// ── Root namespace (legacy) ───────────────────────────────────────────────────
let socket: Socket | null = null;

export const getSocket = (): Socket => {
    if (!socket) socket = io(getSocketUrl(), SOCKET_OPTS);
    return socket;
};

export const connectSocket = (token?: string): Socket => {
    const s = getSocket();
    if (token) s.auth = { token };
    if (!s.connected) s.connect();
    return s;
};

export const disconnectSocket = () => {
    socket?.connected && socket.disconnect();
};

// ── /tracking namespace ───────────────────────────────────────────────────────
let trackingSocket: Socket | null = null;

export const getTrackingSocket = (): Socket => {
    if (!trackingSocket) trackingSocket = io(`${getSocketUrl()}/tracking`, SOCKET_OPTS);
    return trackingSocket;
};

export const connectTrackingSocket = (token?: string): Socket => {
    const s = getTrackingSocket();
    if (token) s.auth = { token };
    if (!s.connected) s.connect();
    return s;
};

// ── /notifications namespace ──────────────────────────────────────────────────
let notifSocket: Socket | null = null;

export const getNotifSocket = (): Socket => {
    if (!notifSocket) notifSocket = io(`${getSocketUrl()}/notifications`, SOCKET_OPTS);
    return notifSocket;
};

export const connectNotifSocket = (token?: string): Socket => {
    const s = getNotifSocket();
    if (token) s.auth = { token };
    if (!s.connected) s.connect();
    return s;
};
