/**
 * FairResolve Client API & Session Management Service
 *
 * Implements HttpOnly cookie transmission via credentials: 'include',
 * in-memory Bearer token fallback (without localStorage vulnerability),
 * and automatic session restoration.
 */

let inMemoryToken: string | null = null;

export function getAuthToken(): string | null {
  return inMemoryToken;
}

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
}

export function removeAuthToken(): void {
  inMemoryToken = null;
}

export async function apiFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});

  if (inMemoryToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${inMemoryToken}`);
  }

  // Anti-CSRF protection header for state-changing requests
  if (!headers.has('X-Requested-With')) {
    headers.set('X-Requested-With', 'XMLHttpRequest');
  }

  // Set Content-Type to application/json by default unless body is FormData or already defined
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(endpoint, {
    credentials: 'include', // Transmits HttpOnly cookie securely
    ...options,
    headers,
  });
}
