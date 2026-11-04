import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * La cookie de sesion solo debe llevar el flag `Secure` cuando la app se
 * sirve de verdad por HTTPS.
 *
 * La regla anterior era "Secure si NODE_ENV=production", y eso dejaba dos
 * casos rotos:
 *
 *   1. WebKit no acepta una cookie Secure sobre `http://localhost`, ni
 *      aunque el origen sea confiable como en Chrome y Firefox. El
 *      sintoma era un bucle de redireccion en mobile-safari.
 *   2. Un despliegue self-hosted servido por HTTP en una red interna
 *      queda con una cookie que el navegador no manda: nadie entra.
 *
 * Estos tests fijan que la decision sale del esquema de la URL publica, y
 * que un override explicito manda sobre esa inferencia.
 */

const ENV_KEYS = [
  'AUTH_USE_SECURE_COOKIES',
  'BETTER_AUTH_URL',
  'NEXT_PUBLIC_APP_URL',
  'NODE_ENV',
] as const;

async function loadUseSecureCookies(): Promise<boolean> {
  vi.resetModules();
  const module = await import('@/lib/auth/config');
  const auth = module.auth as unknown as {
    options: { advanced: { useSecureCookies: boolean } };
  };
  return auth.options.advanced.useSecureCookies;
}

describe('useSecureCookies', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    vi.resetModules();
    for (const key of ENV_KEYS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('enables Secure when the public URL is https', async () => {
    process.env.BETTER_AUTH_URL = 'https://dash-bi.example.com';

    expect(await loadUseSecureCookies()).toBe(true);
  });

  it('disables Secure when the app is served over plain http', async () => {
    // El caso de un operador self-hosted en una red interna, o detras de
    // un proxy que termina TLS. Con Secure, el navegador no manda la
    // cookie y nadie puede entrar.
    process.env.BETTER_AUTH_URL = 'http://dash-bi.internal:3000';

    expect(await loadUseSecureCookies()).toBe(false);
  });

  it('ignores NODE_ENV: production over http is still not Secure', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_URL = 'http://localhost:3000';

    expect(await loadUseSecureCookies()).toBe(false);
  });

  it('lets an explicit override win over the inferred value', async () => {
    process.env.BETTER_AUTH_URL = 'http://dash-bi.internal:3000';
    process.env.AUTH_USE_SECURE_COOKIES = 'true';

    expect(await loadUseSecureCookies()).toBe(true);
  });

  it('falls back to NEXT_PUBLIC_APP_URL when BETTER_AUTH_URL is absent', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://dash-bi.example.com';

    expect(await loadUseSecureCookies()).toBe(true);
  });
});
