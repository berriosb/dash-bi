import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';
import { buildLoggerOptions, formatLogObject } from '@/lib/logger';

/**
 * The logger is the last line of defense for secrets: a driver error
 * routinely carries a DSN with a password, an SDK error carries an API
 * key, and a stack trace repeats the message.
 *
 * The formatter used to redact only TOP-LEVEL strings, so
 * `logger.error({ err })` wrote the error's message and stack in clear.
 * The stack is kept (scrubbed) because losing it would make production
 * debugging impossible.
 */

// Fake markers so the patterns match and GitHub's secret scanner does not.
const FAKE_OPENAI_KEY = 'sk_FAKE_KEY_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FAKE_DSN_PASSWORD = 'sup3rs3cr3t';

function capture(): { log: pino.Logger; output: () => string } {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  // The real logger runs at `silent` under NODE_ENV=test, so the level is
  // raised here: what is under test is the REDACTION, not the level.
  const log = pino({ ...buildLoggerOptions(), level: 'info' }, destination);
  return { log, output: () => chunks.join('') };
}

describe('logger — redacción recursiva', () => {
  it('no escribe el secreto que viene dentro de un Error', () => {
    const { log, output } = capture();
    log.error({ err: new Error(`driver failed with key ${FAKE_OPENAI_KEY}`) }, 'boom');

    expect(output()).not.toContain(FAKE_OPENAI_KEY);
    expect(output()).toContain('[REDACTED]');
  });

  it('no escribe el secreto del stack del Error', () => {
    const { log, output } = capture();
    log.error({ err: new Error(`boom ${FAKE_OPENAI_KEY}`) }, 'x');

    // The stack repeats the message, so it has to be scrubbed too.
    expect(output()).not.toContain(FAKE_OPENAI_KEY);
  });

  it('no escribe la contraseña de un DSN en el mensaje del error', () => {
    const { log, output } = capture();
    log.error(
      { err: new Error('connect ECONNREFUSED postgresql://dashbi:sup3rs3cr3t@db:5432/dashbi') },
      'x',
    );

    expect(output()).not.toContain(FAKE_DSN_PASSWORD);
  });

  it('redacta un secreto en un objeto anidado', () => {
    const { log, output } = capture();
    log.info({ payload: { deep: { key: FAKE_OPENAI_KEY } } }, 'x');

    expect(output()).not.toContain(FAKE_OPENAI_KEY);
  });

  it('redacta un secreto en un array', () => {
    const { log, output } = capture();
    log.info({ keys: [FAKE_OPENAI_KEY] }, 'x');

    expect(output()).not.toContain(FAKE_OPENAI_KEY);
  });

  it('conserva el mensaje del error (la redacción no borra el diagnóstico)', () => {
    const { log, output } = capture();
    log.error({ err: new Error('columna inexistente "clientes"') }, 'x');

    expect(output()).toContain('columna inexistente');
  });

  it('deja intactos los valores que no son secretos', () => {
    const formatted = formatLogObject({ durationMs: 42, ok: true, orgId: 'org-1' });

    expect(formatted).toMatchObject({ durationMs: 42, ok: true, orgId: 'org-1' });
  });

  it('no rompe con valores que no son objetos planos', () => {
    const when = new Date('2026-01-01T00:00:00.000Z');
    const formatted = formatLogObject({ when, count: 3 });

    expect(formatted.count).toBe(3);
    expect(formatted.when).toBe(when);
  });
});
