import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The audit log is the trail that answers "who did what, and when".
 * Two things made it unreliable:
 *
 * 1. The guard that rejects a forbidden metadata key (`apiKey`, `token`,
 *    `password`…) did an EARLY RETURN in production, on the assumption
 *    that "the log redacts anyway". It does not: the redaction only
 *    handled top-level strings, so a nested `{ apiKey: 'sk-…' }` landed in
 *    `audit_log.metadata` in clear, in production, exactly where the guard
 *    was supposed to stop it.
 * 2. The redaction itself was not recursive.
 */
const { mockTxInsert, mockLoggerError } = vi.hoisted(() => ({
  mockTxInsert: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('@/db/client', () => ({
  withOrgContext: async (
    _orgId: string,
    _userId: string | null,
    fn: (tx: { insert: typeof mockTxInsert }) => unknown,
  ) => fn({ insert: mockTxInsert }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: mockLoggerError, warn: vi.fn(), debug: vi.fn() },
}));

import { audit } from '@/lib/audit/log';

function insertPayload(): Record<string, unknown> {
  const last = mockTxInsert.mock.results.at(-1);
  if (!last) throw new Error('mockTxInsert was not called');
  const valuesFn = last.value.values as { mock: { calls: unknown[][] } };
  return valuesFn.mock.calls[0]![0] as Record<string, unknown>;
}

describe('audit — el metadata no puede guardar secrets', () => {
  beforeEach(() => {
    mockTxInsert.mockClear();
    mockTxInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
    mockLoggerError.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('rechaza una key prohibida también en PRODUCCIÓN', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await audit('org-1', 'user-1', 'llm.api_key_created', 'org:org-1', {
      metadata: { apiKey: 'sk-abcdefghijklmnopqrstuvwxyz1234567890' },
    });

    // La fila NO se escribe: el guard falla cerrado.
    expect(mockTxInsert).not.toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it('rechaza una key prohibida ANIDADA', async () => {
    await audit('org-1', 'user-1', 'llm.api_key_created', 'org:org-1', {
      metadata: { config: { token: 'abc' } },
    });

    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it('redacta un secret anidado en el metadata que sí se escribe', async () => {
    await audit('org-1', 'user-1', 'llm.api_key_created', 'org:org-1', {
      metadata: {
        config: { keyPreview: 'sk-abcdefghijklmnopqrstuvwxyz1234567890' },
      },
    });

    const metadata = insertPayload().metadata as Record<string, unknown>;
    const config = metadata.config as Record<string, unknown>;
    expect(config.keyPreview).toBe('[REDACTED]');
  });

  it('sigue escribiendo el metadata limpio', async () => {
    await audit('org-1', 'user-1', 'llm.api_key_created', 'org:org-1', {
      metadata: { provider: 'openai', model: 'gpt-4o' },
    });

    expect(mockTxInsert).toHaveBeenCalledTimes(1);
    expect(insertPayload().metadata).toMatchObject({ provider: 'openai', model: 'gpt-4o' });
  });
});
