export type Status = 'queued' | 'active' | 'completed' | 'cancelled';
export type Order = { id: string; title: string; status: Status; version: number };
export const transitions: Record<Status, Status[]> = {
  queued: ['active', 'cancelled'], active: ['completed', 'cancelled'], completed: [], cancelled: [],
};
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body.detail === 'string') message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail.map((e: {msg: string}) => e.msg).join('; ');
    } catch { /* Retain the HTTP status when an upstream sends non-JSON. */ }
    throw new ApiError(response.status, message);
  }
  return response.json();
}
