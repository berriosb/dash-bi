import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The auth category of the audit trail was EMPTY: ten events declared,
 * none emitted. A login and a logout are the two events that answer
 * "was this account taken over?" — and they are free: better-auth hands
 * over the session hooks.
 *
 * The test drives the REAL hooks of the REAL config (through
 * `auth.options.databaseHooks`), not a copy of them.
 */
const { mockAuditAuthEvent } = vi.hoisted(() => ({
  mockAuditAuthEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/audit/log', () => ({
  auditAuthEvent: mockAuditAuthEvent,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-'.padEnd(40, 'x'));
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
  vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/dashbi');
  vi.stubEnv('DATABASE_READONLY_URL', 'postgresql://user:pass@localhost:5432/dashbi');
  vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
  vi.stubEnv('LLM_KEY_ENCRYPTION_KEY', 'a'.repeat(64));
  vi.stubEnv('PDF_WORKER_SECRET', 'p'.repeat(16));
  vi.clearAllMocks();
});

type SessionHook = { after?: (session: { userId: string }) => Promise<void> };
type AuthHooks = {
  session?: { create?: SessionHook; delete?: SessionHook };
  user?: { create?: { after?: (user: { id: string }) => Promise<void> } };
};

async function loadHooks(): Promise<AuthHooks> {
  const { auth } = await import('@/lib/auth/config');
  const options = (auth as unknown as { options?: { databaseHooks?: AuthHooks } }).options;
  return options?.databaseHooks ?? {};
}

describe('hooks de auditoría de auth', () => {
  it('una sesión creada se audita como auth.login', async () => {
    const hooks = await loadHooks();

    expect(hooks.session?.create?.after).toBeTypeOf('function');
    await hooks.session!.create!.after!({ userId: 'user-1' });

    expect(mockAuditAuthEvent).toHaveBeenCalledWith('user-1', 'auth.login');
  });

  it('una sesión borrada se audita como auth.logout', async () => {
    const hooks = await loadHooks();

    expect(hooks.session?.delete?.after).toBeTypeOf('function');
    await hooks.session!.delete!.after!({ userId: 'user-1' });

    expect(mockAuditAuthEvent).toHaveBeenCalledWith('user-1', 'auth.logout');
  });
});
