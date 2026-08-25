import type {
  CreateSessionResponse,
  DevLoginResponse,
  JoinSessionResponse,
  RTCIceServer,
  SessionEventDto,
} from '@helpdesk/shared';
import { API_BASE } from './config';

export interface SessionInfo {
  id: string;
  code: string;
  status: string;
  createdAt: string;
  connectedAt: string | null;
  endedAt: string | null;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('ha.access');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(body.message ?? `${res.status} ${res.statusText}`);
  return body;
}

export const api = {
  async devLogin(email: string, displayName?: string): Promise<DevLoginResponse> {
    const res = await fetch(`${API_BASE}/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, displayName }),
    });
    return json<DevLoginResponse>(res);
  },

  async createSession(): Promise<CreateSessionResponse> {
    const res = await fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    });
    return json<CreateSessionResponse>(res);
  },

  async joinSession(code: string, joinToken: string, role: 'technician' | 'endpoint'): Promise<JoinSessionResponse> {
    const res = await fetch(`${API_BASE}/sessions/${code}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ joinToken, role }),
    });
    return json<JoinSessionResponse>(res);
  },

  async endSession(code: string): Promise<void> {
    const res = await fetch(`${API_BASE}/sessions/${code}/end`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    });
    await json<unknown>(res);
  },

  async getSession(code: string): Promise<{ session: SessionInfo; events: SessionEventDto[] }> {
    const res = await fetch(`${API_BASE}/sessions/${code}`, { headers: authHeaders() });
    return json(res);
  },

  async getIceConfig(): Promise<{ iceServers: RTCIceServer[]; hasTurn: boolean }> {
    const res = await fetch(`${API_BASE}/config/ice`);
    return json(res);
  },
};

export function storeAccess(token: string): void {
  localStorage.setItem('ha.access', token);
}

export function getAccess(): string | null {
  return localStorage.getItem('ha.access');
}

export function clearAccess(): void {
  localStorage.removeItem('ha.access');
}
