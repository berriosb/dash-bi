import { describe, it, expect } from 'vitest';
import { redactSecrets, redactObject } from '@/lib/redact';

describe('redactSecrets', () => {
  it('redacts OpenAI API keys', () => {
    const input = 'Using key sk_FAKE_KEY_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(redactSecrets(input)).toContain('[REDACTED]');
    expect(redactSecrets(input)).not.toContain('sk_FAKE_KEY_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('redacts Anthropic API keys', () => {
    const input = 'Bearer sk_FAKE_ANT_aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(redactSecrets(input)).toContain('[REDACTED]');
  });

  it('redacts Google API keys', () => {
    const input = 'AIza_FAKE_KEY_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(redactSecrets(input)).toContain('[REDACTED]');
  });

  it('redacts Stripe API keys', () => {
    expect(redactSecrets('sk_live_aaaaaaaaaaaaaaaaaaaaaaa')).toContain('[REDACTED]');
    expect(redactSecrets('rk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toContain('[REDACTED]');
  });

  it('redacts JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redactSecrets(`token: ${jwt}`)).toContain('[REDACTED]');
  });

  it('preserves non-secret strings', () => {
    const safe = 'This is a normal log message with no secrets';
    expect(redactSecrets(safe)).toBe(safe);
  });

  it('handles empty strings', () => {
    expect(redactSecrets('')).toBe('');
    expect(redactSecrets(null as unknown as string)).toBe(null);
  });
});

describe('redactObject', () => {
  it('redacts secrets in nested objects', () => {
    const obj = {
      user: 'john',
      apiKey: 'sk_FAKE_KEY_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      nested: {
        token: 'sk_FAKE_ANT_aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
    };

    const result = redactObject(obj);

    expect(result.user).toBe('john');
    expect(result.apiKey).toContain('[REDACTED]');
    expect((result.nested as { token: string }).token).toContain('[REDACTED]');
  });

  it('preserves non-string values', () => {
    const obj = {
      count: 42,
      active: true,
      tags: ['a', 'b'],
      nested: { deep: 'value' },
    };

    expect(redactObject(obj)).toEqual(obj);
  });
});