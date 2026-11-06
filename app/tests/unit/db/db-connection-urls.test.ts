import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `DATABASE_READONLY_URL` is a security control, not a preference.
 *
 * It is the connection string of the Postgres role that the SQL generated
 * by the model runs as — a role with SELECT-only permissions. The client
 * used to fall back to `postgresql://localhost:5432/dashbi`, the same
 * string as the app's own connection: a deployment that forgot to set the
 * variable ran the model's SQL with the app role, and nothing said so.
 * `validate-query` was the only thing between a prompt and a DROP.
 *
 * `env.ts` already declared the variable REQUIRED. The client read
 * `process.env` directly and skipped that validation, so the schema and
 * the code disagreed — and the code is the one that runs.
 */
const CLIENT_PATH = resolve(__dirname, '../../../src/db/client.ts');

function clientSource(): string {
  return readFileSync(CLIENT_PATH, 'utf8');
}

/**
 * The comments are stripped before the scan: this file's own documentation
 * quotes the fallback it is forbidding, and a scanner that reads the
 * comments would flag the explanation.
 */
function clientCode(): string {
  return clientSource()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // `[^:]` keeps `https://` inside a string from eating the rest of the line.
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Import the module fresh, so its top-level code runs again. */
async function importClient(): Promise<unknown> {
  vi.resetModules();
  return await import('@/db/client');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe('las conexiones a la DB no caen a un default', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('falla al cargar el cliente si DATABASE_READONLY_URL no está', async () => {
    vi.stubEnv('DATABASE_READONLY_URL', '');

    await expect(importClient()).rejects.toThrow(/DATABASE_READONLY_URL/);
  });

  it('falla al cargar el cliente si DATABASE_URL no está', async () => {
    vi.stubEnv('DATABASE_URL', '');

    await expect(importClient()).rejects.toThrow(/DATABASE_URL/);
  });

  it('el error dice qué control queda apagado', async () => {
    vi.stubEnv('DATABASE_READONLY_URL', '');

    const error = await importClient().catch((e: unknown) => e);

    // El mensaje tiene que explicar la CONSECUENCIA, no solo el nombre de
    // la variable: quien lo lee tiene que entender que sin esto el SQL del
    // modelo corre con permisos de escritura.
    expect(messageOf(error)).toMatch(/role|read-only|readonly/i);
    expect(messageOf(error)).toMatch(/write|write/i);
  });

  it('carga sin problema cuando las dos variables están', async () => {
    await expect(importClient()).resolves.toBeDefined();
  });

  it('no falla durante el build, donde los módulos se cargan pero no se consultan', async () => {
    // `next build` evalúa los módulos de las rutas ("Collecting page data"),
    // así que este archivo se carga en el build. Lo que no pasa en el build
    // es una consulta: fallar por una variable de runtime dejaría el build
    // atado a la configuración de la máquina.
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('DATABASE_READONLY_URL', '');

    await expect(importClient()).resolves.toBeDefined();
  });

  it('el cliente no tiene un fallback para ninguna de las dos variables', () => {
    const code = clientCode();

    // El invariante, sobre la fuente: un `||` que devuelve una URL fija
    // devuelve a esta exacta conversación dentro de seis meses.
    expect(code).not.toMatch(/process\.env\.DATABASE_URL\s*\|\|/);
    expect(code).not.toMatch(/process\.env\.DATABASE_READONLY_URL\s*\|\|/);
  });

  it('no repite la URL del fallback en ningún sitio del cliente', () => {
    // `postgresql://localhost:5432/dashbi` era la cadena del fallback.
    // Que no aparezca NADA en el código es más fuerte que comprobar que
    // no esté en un `||`: significa que no hay una segunda URL capaz de
    // aparecer por una ruta que nadie revisó.
    expect(clientCode()).not.toContain('postgresql://localhost:5432/dashbi');
  });
});
