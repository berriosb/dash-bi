import { describe, it, expect, vi, beforeEach } from 'vitest';
import { instantiateTemplate } from '@/lib/templates/service';
import { db, withOrgContext } from '@/db/client';
import { audit } from '@/lib/audit/log';

vi.mock('@/db/client', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() =>
          Promise.resolve([
            {
              id: 'dash_template_123',
              orgId: 'org_test_1',
              title: 'SaaS MRR & Retención',
              theme: 'moderno-saas',
              archetype: 'kpi-grid',
              widgets: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
        ),
      })),
    })),
  },
  withOrgContext: vi.fn(async (orgId, userId, fn) =>
    fn({
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() =>
            Promise.resolve([
              {
                id: 'dash_template_123',
                orgId: 'org_test_1',
                title: 'SaaS MRR & Retención',
                theme: 'moderno-saas',
                archetype: 'kpi-grid',
                widgets: [],
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ]),
          ),
        })),
      })),
    }),
  ),
}));

vi.mock('@/lib/audit/log', () => ({
  audit: vi.fn(() => Promise.resolve()),
}));

describe('instantiateTemplate service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('instantiates a valid template with RLS isolation and logs audit event', async () => {
    const result = await instantiateTemplate({
      templateId: 'saas-mrr-analytics',
      orgId: 'org_test_1',
      userId: 'usr_test_1',
      title: 'Mi Dashboard SaaS Custom',
    });

    expect(withOrgContext).toHaveBeenCalledWith('org_test_1', 'usr_test_1', expect.any(Function));
    expect(audit).toHaveBeenCalledWith(
      'org_test_1',
      'usr_test_1',
      'dashboard.created',
      'dashboard:dash_template_123',
      expect.any(Object),
    );
    expect(result.id).toBe('dash_template_123');
  });

  it('throws an error if template ID is invalid', async () => {
    await expect(
      instantiateTemplate({
        templateId: 'non-existent-template',
        orgId: 'org_test_1',
        userId: 'usr_test_1',
      }),
    ).rejects.toThrow('Template "non-existent-template" no encontrado');
  });
});
