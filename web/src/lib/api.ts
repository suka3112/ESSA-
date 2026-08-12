export interface ApiErrorShape {
  errorCode: string;
  message: string;
  correlationId?: string;
  detail?: unknown;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorShape
  ) {
    super(body.message);
  }
}

let token: string | null = localStorage.getItem('essa.token');

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('essa.token', t);
  else localStorage.removeItem('essa.token');
}

export function getToken() {
  return token;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let parsed: ApiErrorShape;
    try {
      parsed = (await res.json()) as ApiErrorShape;
    } catch {
      parsed = { errorCode: 'HTTP_ERROR', message: res.statusText };
    }
    throw new ApiError(res.status, parsed);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}
