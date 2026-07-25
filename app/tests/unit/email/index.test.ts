import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests del mock email provider.
 * Sprint 1: el adapter Resend requiere API key real; el mock es la
 * opción por defecto en dev sin claves.
 */

describe('MockEmailProvider', () => {
  const originalApiKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_PROVIDER;
  });

  afterEach(() => {
    process.env.RESEND_API_KEY = originalApiKey;
  });

  it('is used by default when no RESEND_API_KEY is configured', async () => {
    const { getEmailProvider, _resetEmailProvider } = await import('@/lib/email');
    _resetEmailProvider();
    const provider = getEmailProvider();
    expect(provider.type).toBe('mock');
  });

  it('returns a deterministic synthetic id', async () => {
    const { getEmailProvider, _resetEmailProvider } = await import('@/lib/email');
    _resetEmailProvider();
    const provider = getEmailProvider();
    const result = await provider.send({
      to: 'test@example.com',
      subject: 'Hola',
      html: '<p>Hola</p>',
    });
    expect(result.provider).toBe('mock');
    expect(result.id).toMatch(/^mock_/);
  });

  it('never throws on send', async () => {
    const { getEmailProvider, _resetEmailProvider } = await import('@/lib/email');
    _resetEmailProvider();
    const provider = getEmailProvider();
    await expect(
      provider.send({
        to: ['a@b.com', 'c@d.com'],
        subject: 'Multi',
        html: '<p>x</p>',
        tags: { kind: 'test' },
      }),
    ).resolves.toBeDefined();
  });

  it('Resend provider wins when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 're_test_key_for_unit_test';
    const { getEmailProvider, _resetEmailProvider } = await import('@/lib/email');
    _resetEmailProvider();
    const provider = getEmailProvider();
    expect(provider.type).toBe('resend');
  });
});