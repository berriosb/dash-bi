import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  encryptAlertChannels,
  decryptAlertChannels,
  maskAlertChannels,
} from '@/lib/alerts/schemas';
import { decryptApiKey } from '@/lib/security/encryption';
import type { AlertChannelConfig } from '@/lib/alerts/types';

/**
 * The custom headers of a webhook are where the bearer token lives, and
 * they were stored in PLAINTEXT: `encryptAlertChannels` encrypted the
 * endpoint URL and left the header map untouched. The URL was the visible
 * half of the secret; the headers were the other half.
 */
const MASTER_KEY = 'a'.repeat(64);

function webhook(headers?: Record<string, string>): AlertChannelConfig[] {
  return [
    {
      type: 'webhook' as const,
      url: 'https://example.com/hook',
      ...(headers ? { headers } : {}),
    },
  ];
}

/** The header map of the first channel, narrowed to the webhook variant. */
function headersOf(channels: AlertChannelConfig[]): Record<string, string> | undefined {
  const channel = channels[0];
  if (channel?.type !== 'webhook') throw new Error('expected a webhook channel');
  return channel.headers;
}

describe('cifrado de los canales de alerta', () => {
  beforeEach(() => {
    vi.stubEnv('LLM_KEY_ENCRYPTION_KEY', MASTER_KEY);
  });

  it('cifra los valores de los headers del webhook', () => {
    const encrypted = encryptAlertChannels(
      webhook({ Authorization: 'Bearer sk_FAKE_TOKEN_aaaaaaaaaaaaaaaa' }),
    );

    const stored = headersOf(encrypted)?.Authorization;
    expect(stored).toBeDefined();
    expect(stored).not.toContain('sk_FAKE_TOKEN_aaaaaaaaaaaaaaaa');
    expect(decryptApiKey(stored!)).toBe('Bearer sk_FAKE_TOKEN_aaaaaaaaaaaaaaaa');
  });

  it('no deja el token del header en el texto plano que se guarda', () => {
    const serialized = JSON.stringify(
      encryptAlertChannels(webhook({ Authorization: 'Bearer sk_FAKE_TOKEN_aaaaaaaaaaaaaaaa' })),
    );

    expect(serialized).not.toContain('sk_FAKE_TOKEN_aaaaaaaaaaaaaaaa');
  });

  it('descifra los headers en el camino de entrega', () => {
    const encrypted = encryptAlertChannels(
      webhook({ Authorization: 'Bearer sk_FAKE_TOKEN_aaaaaaaaaaaaaaaa' }),
    );
    const decrypted = decryptAlertChannels(encrypted);

    expect(headersOf(decrypted)?.Authorization).toBe('Bearer sk_FAKE_TOKEN_aaaaaaaaaaaaaaaa');
  });

  it('deja los headers en claro de una fila vieja en claro (no rompe la entrega)', () => {
    // Las filas ya guardadas tienen el header en claro: el camino de
    // entrega tiene que seguir funcionando con ellas.
    const decrypted = decryptAlertChannels(
      webhook({ Authorization: 'Bearer valor-en-claro' }),
    );

    expect(headersOf(decrypted)?.Authorization).toBe('Bearer valor-en-claro');
  });

  it('es idempotente: cifrar dos veces no cifra dos veces', () => {
    const once = encryptAlertChannels(
      webhook({ Authorization: 'Bearer sk_FAKE_TOKEN_aaaaaaaaaaaaaaaa' }),
    );
    const twice = encryptAlertChannels(once);

    expect(headersOf(twice)?.Authorization).toBe(headersOf(once)?.Authorization);
  });

  it('no toca los headers que no tienen valor', () => {
    const encrypted = encryptAlertChannels(webhook());

    expect(headersOf(encrypted)).toBeUndefined();
  });

  it('sigue enmascarando los headers cuando salen por la API', () => {
    const encrypted = encryptAlertChannels(
      webhook({ Authorization: 'Bearer sk_FAKE_TOKEN_aaaaaaaaaaaaaaaa' }),
    );
    const masked = maskAlertChannels(encrypted);

    expect(headersOf(masked)?.Authorization).toBe('[REDACTED]');
  });
});
