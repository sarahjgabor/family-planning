// Thin fetch wrapper around the server API. Keeping all network calls here
// means a future React Native app can reuse this file almost verbatim — only
// the token storage (localStorage) would need swapping for AsyncStorage.

const TOKEN_KEY = 'family-planning-token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = res.headers.get('content-type')?.includes('application/json')
    ? await res.json()
    : null;

  if (!res.ok) {
    const message = (data && (data as { error?: string }).error) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

// ---- Shared types ----

export interface User {
  id: number;
  name: string;
  email: string;
}

export interface Child {
  id: number;
  name: string;
  color: string;
}

export interface Feed {
  id: number;
  label: string;
  url: string;
  color: string;
  childId: number | null;
  lastSynced: string | null;
  lastError: string | null;
  eventCount: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  color: string;
  editable: boolean;
  extendedProps: {
    source: 'local' | 'feed';
    childId: number | null;
    childName: string | null;
    location: string | null;
    notes: string | null;
    feedLabel: string | null;
  };
}
