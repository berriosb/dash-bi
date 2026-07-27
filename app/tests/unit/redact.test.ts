import { describe, it, expect } from 'vitest';
import { redactSecrets, redactObject } from '@/lib/redact';

// Fixture keys use repeating chars so the redacter matches them by length,
// but no real provider will ever issue these. Safe to commit.
const FAKE_OPENAI_KEY = 'sk_FAKE_KEY_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FAKE_ANTHROPIC_KEY = 'sk_FAKE_ANT_aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAaaaaaaaaaaaaaaa';
const FAKE_GOOGLE_KEY = 'AIza_FAKE_KEY_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FAKE_STRIPE_LIVE_KEY = 'sk_live_aaaaaaaaaaaaaaaaaaaaaaa';
const FAKE_STRIPE_RESTRICTED_KEY = 'rk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FAKE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('redactSecrets', () => {
  it('redacts OpenAI API keys', () => {
    const input = `Using key ${FAKE_OPENAI_KEY}`;
    expect(redactSecrets(input)).toContain('[REDACTED]');
    expect(redactSecrets(input)).not.toContain(FAKE_OPENAI_KEY);
  });

  it('redacts Anthropic API keys', () => {
    const input = `Bearer ${FAKE_ANTHROPIC_KEY}`;
    expect(redactSecrets(input)).toContain('[REDACTED]');
  });

  it('redacts Google API keys', () => {
    const input = FAKE_GOOGLE_KEY;
    expect(redactSecrets(input)).toContain('[REDACTED]');
  });

  it('redacts Stripe API keys', () => {
    expect(redactSecrets(FAKE_STRIPE_LIVE_KEY)).toContain('[REDACTED]');
    expect(redactSecrets(FAKE_STRIPE_RESTRICTED_KEY)).toContain('[REDACTED]');
  });

  it('redacts JWT tokens', () => {
    expect(redactSecrets(`token: ${FAKE_JWT}`)).toContain('[REDACTED]');
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
      apiKey: FAKE_OPENAI_KEY,
      nested: {
        token: FAKE_ANTHROPIC_KEY,
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