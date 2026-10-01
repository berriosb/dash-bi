import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { redactError } from '@/lib/redact';

/**
 * T5 — the three `console.error` calls in `auth/config.ts` logged the raw
 * error object from the email senders. Those live inside the magic-link,
 * reset-password and verify-email flows, so the thing being logged on failure
 * is exactly the code path that handles a URL containing a single-use token.
 *
 * Switching to Pino alone does not close it: `logger.redact.paths` is a list
 * of FIELD names, and a token embedded inside an error MESSAGE matches none
 * of them. `redactSecrets` alone does not close it either: better-auth
 * verification tokens are shorter than the 40-char generic pattern.
 *
 * So the error has to be reduced to a safe shape before it reaches the log.
 */
describe('redactError', () => {
  it('keeps the name and a usable message for a plain error', () => {
    const out = redactError(new Error('Email send error: connection refused'));
    expect(out.name).toBe('Error');
    expect(out.message).toBe('Email send error: connection refused');
  });

  it('removes a magic-link URL, token included', () => {
    const err = new Error(
      'failed to deliver https://dash-bi.com/api/auth/magic-link/verify?token=abc123def456&email=a@b.com',
    );
    const out = redactError(err);
    expect(out.message).not.toContain('abc123def456');
    expect(out.message).not.toContain('magic-link/verify');
    expect(out.message).toContain('[URL_REDACTED]');
  });

  it('redacts several URLs in the same message', () => {
    const err = new Error('a https://x.test/1?token=t1 b https://y.test/2?token=t2 c');
    const out = redactError(err);
    expect(out.message).not.toContain('t1');
    expect(out.message).not.toContain('t2');
  });

  it('redacts an API key that redactSecrets already covers', () => {
    const err = new Error('auth failed for key sk-ant-abcdefghijklmnopqrstuvwxyz012345');
    const out = redactError(err);
    expect(out.message).not.toContain('sk-ant-abcdefghijklmnopqrstuvwxyz012345');
    expect(out.message).toContain('[REDACTED]');
  });

  it('does not walk into cause, which is where providers hide the request', () => {
    const err = new Error('outer', {
      cause: new Error('token=supersecrettokenvalue123'),
    });
    const out = redactError(err);
    // The cause is dropped entirely rather than summarised: a redacted
    // summary still leaks structure, and the outer message is enough to
    // debug a failed send.
    expect(out.message).not.toContain('supersecrettokenvalue123');
    expect(Object.keys(out)).toEqual(['name', 'message']);
  });

  it('survives non-Error values without throwing', () => {
    expect(redactError('plain string').message).toBe('plain string');
    expect(redactError(undefined).message).toBe('Unknown error');
    expect(redactError(null).message).toBe('Unknown error');
    expect(redactError({ weird: true }).message).toBe('Unknown error');
    expect(redactError(42).message).toBe('Unknown error');
  });

  it('preserves the error subclass name so TypeError stays TypeError', () => {
    class ProviderTimeout extends Error {
      override name = 'ProviderTimeout';
    }
    expect(redactError(new ProviderTimeout('took too long')).name).toBe('ProviderTimeout');
  });

  it('never returns a message longer than the input, so redaction cannot grow a log line', () => {
    const long = 'x'.repeat(5000);
    expect(redactError(new Error(long)).message.length).toBeLessThanOrEqual(long.length);
  });
});

/**
 * ESLint cannot hold this line. `eslint.config.mjs` sets
 * `no-console: ['warn', { allow: ['warn', 'error', 'info'] }]`, so
 * `console.error` is explicitly permitted and the only thing standing between
 * a token URL and stdout is whoever remembers to use the logger. This pins it.
 *
 * `env.ts` is deliberately out of scope: it logs at boot, before the logger is
 * guaranteed to be configured, and it prints field NAMES, not values.
 */
describe('T5 guard: no console.* in the auth module', () => {
  // Scanned dynamically rather than hardcoded, so a new file in the module is
  // covered the day it is added instead of the day someone remembers.
  const files = readdirSync(join(process.cwd(), 'src/lib/auth')).filter((f) =>
    f.endsWith('.ts'),
  );

  it('finds the auth sources it expects', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('%s has no console.* call', (file) => {
    const source = readFileSync(join(process.cwd(), 'src/lib/auth', file), 'utf8');
    // Strip comments so the explanatory prose in config.ts, which quotes the
    // old `console.error(...)` call to explain why it went away, does not read
    // as a live call.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bconsole\s*\./);
  });
});
