import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures mockInsert is initialized before vi.mock factory runs (which is hoisted).
// Sprint 1.5: audit() ahora corre dentro de withOrgContext(), que recibe
// `tx` y delega el insert en `tx.insert`. Los tests mockean `tx.insert`
// para preservar el contrato de aislamiento (no usamos `db.insert`).
const { mockTxInsert } = vi.hoisted(() => {
  const mockTxInsert = vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });
  return { mockTxInsert };
});

vi.mock('@/db/client', () => ({
  withOrgContext: async (_orgId: string, _userId: string | null, fn: (tx: { insert: typeof mockTxInsert }) => unknown) =>
    fn({ insert: mockTxInsert }),
  withSystemContext: async (fn: (tx: { insert: typeof mockTxInsert }) => unknown) => fn({ insert: mockTxInsert }),
}));

import { audit, _auditUnsafe } from '@/lib/audit/log';
import { auditLog } from '@/db/schema';
import type { AuditEvent } from '@/lib/audit/events';

/** Helper to extract the first values() call payload from a mock. */
function getInsertPayload(): Record<string, unknown> {
  const lastResult = mockTxInsert.mock.results.at(-1);
  if (!lastResult) throw new Error('mockInsert was not called');
  const valuesFn = (lastResult.value as { values: ReturnType<typeof vi.fn> }).values;
  const lastCall = valuesFn.mock.calls.at(-1);
  if (!lastCall) throw new Error('values() was not called');
  return lastCall[0] as Record<string, unknown>;
}

describe('Audit log helper', () => {
  beforeEach(() => {
    mockTxInsert.mockClear();
    mockTxInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });
  });

  describe('audit() — primary API', () => {
    it('inserts a row in audit_log with required fields', async () => {
      await audit('org-123', 'user-456', 'dashboard.generated', 'dashboard:dash-789');

      expect(mockTxInsert).toHaveBeenCalledTimes(1);
      expect(mockTxInsert).toHaveBeenCalledWith(auditLog);

      const insertPayload = getInsertPayload();
      expect(insertPayload).toMatchObject({
        orgId: 'org-123',
        userId: 'user-456',
        action: 'dashboard.generated',
        resource: 'dashboard:dash-789',
      });
    });

    it('allows null userId for system events', async () => {
      await audit('org-123', null, 'datasource.connection_failed');

      const insertPayload = getInsertPayload();
      expect(insertPayload.userId).toBeNull();
      expect(insertPayload.action).toBe('datasource.connection_failed');
    });

    it('redacts API keys in metadata strings', async () => {
      await audit('org-1', 'user-1', 'llm.api_key_created', 'org:org-1', {
        metadata: {
          provider: 'openai',
          keyPreview: 'sk-abcdefghijklmnopqrstuvwxyz1234567890',
        },
      });

      const insertPayload = getInsertPayload();
      const metadata = insertPayload.metadata as Record<string, unknown>;
      expect(metadata.provider).toBe('openai');
      expect(metadata.keyPreview).toBe('[REDACTED]');
    });

    it('extracts IP from x-forwarded-for header', async () => {
      const req = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '192.168.1.100, 10.0.0.1',
          'user-agent': 'Mozilla/5.0',
        },
      });

      await audit('org-1', 'user-1', 'auth.login', undefined, { req });

      const insertPayload = getInsertPayload();
      expect(insertPayload.ip).toBe('192.168.1.100'); // first IP
      expect(insertPayload.userAgent).toBe('Mozilla/5.0');
    });

    it('extracts IP from x-real-ip when x-forwarded-for absent', async () => {
      const req = new Request('http://localhost', {
        headers: {
          'x-real-ip': '203.0.113.42',
        },
      });

      await audit('org-1', 'user-1', 'auth.login', undefined, { req });

      const insertPayload = getInsertPayload();
      expect(insertPayload.ip).toBe('203.0.113.42');
    });

    it('does NOT throw when DB fails (audit log must never break flow)', async () => {
      mockTxInsert.mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error('connection lost')),
      });

      await expect(
        audit('org-1', 'user-1', 'dashboard.created'),
      ).resolves.toBeUndefined();
    });

    it('throws in dev mode when metadata contains forbidden keys', async () => {
      await expect(
        _auditUnsafe('org-1', 'user-1', 'auth.login', undefined, {
          metadata: { password: 'secret123' },
        }),
      ).rejects.toThrow(/forbidden key "password"/);
    });

    it('audit() silently swallows forbidden-key errors (must not break flow)', async () => {
      await expect(
        audit('org-1', 'user-1', 'auth.login', undefined, {
          metadata: { password: 'secret123' },
        }),
      ).resolves.toBeUndefined();
    });

    it('accepts complex metadata objects', async () => {
      await audit('org-1', 'user-1', 'dashboard.generated', 'dashboard:d1', {
        metadata: {
          promptLength: 250,
          archetype: 'kpi-grid',
          widgetCount: 8,
          costUsd: 0.0023,
          nested: { ok: true },
          arr: [1, 2, 3],
        },
      });

      const insertPayload = getInsertPayload();
      const metadata = insertPayload.metadata as Record<string, unknown>;
      expect(metadata.promptLength).toBe(250);
      expect(metadata.archetype).toBe('kpi-grid');
      expect(metadata.widgetCount).toBe(8);
      expect(metadata.nested).toEqual({ ok: true });
      expect(metadata.arr).toEqual([1, 2, 3]);
    });
  });

  describe('Audit event coverage', () => {
    const events = [
      'auth.login',
      'auth.signup',
      'auth.magic_link_used',
      'auth.failed_login',
      'org.created',
      'org.member_invited',
      'llm.config_updated',
      'llm.api_key_rotated',
      'datasource.created',
      'datasource.schema_refreshed',
      'dashboard.generated',
      'dashboard.shared',
      'query.executed',
      'query.failed',
      'query.cache_hit',
      'export.pdf_completed',
      'export.link_generated',
      'public_link.viewed',
      // Sprint 7 — Alerts (spec/alerts.md §9.3)
      'alert.created',
      'alert.updated',
      'alert.deleted',
      'alert.paused',
      'alert.resumed',
      'alert.fired',
      'alert.delivered',
      'alert.delivery_failed',
      'alert.evaluation_failed',
      'alert.evaluation_suppressed',
    ] as const satisfies readonly AuditEvent[];

    it.each(events)('supports event "%s"', async (event) => {
      await audit('org-1', 'user-1', event);
      expect(mockTxInsert).toHaveBeenCalled();
    });
  });

  describe('_auditUnsafe — test-only variant', () => {
    it('propagates DB errors', async () => {
      mockTxInsert.mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error('connection lost')),
      });

      await expect(
        _auditUnsafe('org-1', 'user-1', 'dashboard.created'),
      ).rejects.toThrow('connection lost');
    });
  });
});