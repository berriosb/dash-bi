// NOTA: este archivo corre en el entorno `node` a propósito. Con
// `happy-dom`, el `Request` de happy-dom descarta los headers del init
// (`new NextRequest(url, { headers })` llega sin headers), y el gate
// vería siempre "sin Origin" → el test no probaría nada.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

/**
 * The CSRF gate at the middleware level.
 *
 * `SameSite=Lax` does not protect the app's own mutating routes from a
 * same-site attacker: a page on `evil.example.com` can POST to
 * `app.example.com` and the session cookie travels with it.
 */
describe('middleware — gate CSRF por Origin', () => {
  beforeEach(() => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://bi.example.com');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://bi.example.com');
  });

  function post(path: string, headers: Record<string, string>): NextRequest {
    return new NextRequest(`https://bi.example.com${path}`, {
      method: 'POST',
      headers: { host: 'bi.example.com', ...headers },
    });
  }

  it('rechaza un POST mutante con un Origin ajeno', async () => {
    const res = await middleware(
      post('/api/organizations/llm-key', { origin: 'https://evil.example.com' }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('auth.forbidden');
    expect(body.retryable).toBe(false);
  });

  it('rechaza un POST con Origin null (iframe sandboxeado)', async () => {
    const res = await middleware(
      post('/api/dashboards', { origin: 'null' }),
    );

    expect(res.status).toBe(403);
  });

  it('deja pasar un POST con nuestro propio Origin', async () => {
    const res = await middleware(
      post('/api/dashboards', { origin: 'https://bi.example.com' }),
    );

    // Sin sesión, la respuesta es el redirect a /login (no 403).
    expect(res.status).not.toBe(403);
  });

  it('no rechaza los GET', async () => {
    const res = await middleware(
      new NextRequest('https://bi.example.com/api/dashboards', {
        headers: { host: 'bi.example.com', origin: 'https://evil.example.com' },
      }),
    );

    expect(res.status).not.toBe(403);
  });

  it('deja pasar las rutas de better-auth (tienen su propio control de origin)', async () => {
    const res = await middleware(
      post('/api/auth/sign-in/email', { origin: 'https://evil.example.com' }),
    );

    expect(res.status).not.toBe(403);
  });

  it('rechaza un Referer ajeno cuando no hay Origin', async () => {
    const res = await middleware(
      post('/api/organizations/members', { referer: 'https://evil.example.com/x' }),
    );

    expect(res.status).toBe(403);
  });

  it('deja pasar un cliente sin Origin ni Referer (no es un navegador)', async () => {
    const res = await middleware(post('/api/dashboards', {}));

    expect(res.status).not.toBe(403);
  });
});
