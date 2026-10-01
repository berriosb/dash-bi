import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * HIGH-9 — `dashboards/generate` must honour the org's BYOK config.
 *
 * `/api/nlqa/ask` and `/api/widgets/explain` both read `llmProvider`,
 * `llmModel` and `llmApiKeyEncrypted` from the org row and hand them to
 * `AiGateway`. This route built `new AiGateway()` with no arguments and
 * hardcoded `provider='openai'`, `model='gpt-4o'`, so the key an org saved
 * through the BYOK endpoint was never used here — the call was billed to
 * the platform instead.
 *
 * The cost row (`recordLLMUsage`) was truthful about what it spent, which is
 * exactly what made the bug invisible: the usage log agreed with itself and
 * nobody could see that the org's provider was ignored.
 */

const {
  mockRequireAuth,
  mockWithOrgContext,
  mockCheckRateLimit,
  mockAiGateway,
  mockGenerateDashboard,
  mockGenerateNLQAEdit,
  mockRecordLLMUsage,
  mockAssertOrgCanSpendLlm,
  mockAudit,
  mockResolveConnector,
  mockHydrateDashboard,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockWithOrgContext: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockAiGateway: vi.fn(),
  mockGenerateDashboard: vi.fn(),
  mockGenerateNLQAEdit: vi.fn(),
  mockRecordLLMUsage: vi.fn(),
  mockAssertOrgCanSpendLlm: vi.fn(),
  mockAudit: vi.fn(),
  mockResolveConnector: vi.fn(),
  mockHydrateDashboard: vi.fn(),
}));

vi.mock('@/lib/auth/request', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/db/client', () => ({ withOrgContext: mockWithOrgContext }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock('@/lib/ai/gateway', () => ({ AiGateway: mockAiGateway }));
vi.mock('@/lib/ai/quota', () => ({
  recordLLMUsage: mockRecordLLMUsage,
  assertOrgCanSpendLlm: mockAssertOrgCanSpendLlm,
}));
vi.mock('@/lib/audit/log', () => ({ audit: mockAudit }));
vi.mock('@/lib/query-engine/resolve', () => ({
  resolveConnector: mockResolveConnector,
  DataSourceNotFoundError: class DataSourceNotFoundError extends Error {},
}));
vi.mock('@/lib/query-engine/dashboard', () => ({ hydrateDashboard: mockHydrateDashboard }));

import { POST } from '@/app/api/dashboards/generate/route';

/** The org the fake `withOrgContext` returns for the config SELECT. */
let orgRow: {
  plan: string;
  llmProvider: string | null;
  llmModel: string | null;
  llmApiKeyEncrypted: string | null;
};

function makeRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/dashboards/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/dashboards/generate — BYOK (HIGH-9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      email: 'user@example.com',
      orgId: 'org-456',
      role: 'editor',
    });
    mockAssertOrgCanSpendLlm.mockResolvedValue(undefined);
    mockRecordLLMUsage.mockResolvedValue(undefined);
    mockAudit.mockResolvedValue(undefined);
    mockHydrateDashboard.mockImplementation(
      async (_orgId: string, _userId: string, widgets: unknown[]) => widgets,
    );
    mockResolveConnector.mockResolvedValue({ type: 'postgres', getSchema: async () => ({}) });

    orgRow = {
      plan: 'pro',
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4',
      llmApiKeyEncrypted: 'encrypted-key-abc',
    };

    mockWithOrgContext.mockImplementation(async (...args: unknown[]) => {
      const callback = (typeof args[2] === 'function' ? args[2] : args[3]) as (
        tx: unknown,
      ) => unknown;
      const fakeTx = {
        select: () => ({ from: () => ({ where: () => [orgRow] }) }),
        insert: () => ({
          values: () => ({
            returning: () => [{ id: 'dash-1', orgId: 'org-456', title: 'T', widgets: [] }],
          }),
        }),
        update: () => ({
          set: () => ({ where: () => ({ returning: () => [{ id: 'dash-1', widgets: [] }] }) }),
        }),
        query: { dashboards: { findFirst: async () => null } },
      };
      return callback(fakeTx);
    });

    mockAiGateway.mockImplementation(() => ({
      generateDashboard: mockGenerateDashboard,
      generateNLQAEdit: mockGenerateNLQAEdit,
    }));
  });

  it('builds the gateway with the org provider, model and encrypted key', async () => {
    mockGenerateDashboard.mockResolvedValue({
      title: 'Ingresos',
      description: 'd',
      theme: 'moderno-saas',
      widgets: [],
      usage: { promptTokens: 10, completionTokens: 20 },
    });

    const res = await POST(makeRequest({ prompt: 'ventas por mes', dataSourceId: 'ds-1' }));

    expect(res.status).toBe(201);
    expect(mockAiGateway).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4', 'encrypted-key-abc');
  });

  it('records usage against the provider and model it actually used', async () => {
    mockGenerateDashboard.mockResolvedValue({
      title: 'Ingresos',
      description: 'd',
      theme: 'moderno-saas',
      widgets: [],
      usage: { promptTokens: 10, completionTokens: 20 },
    });

    await POST(makeRequest({ prompt: 'ventas por mes', dataSourceId: 'ds-1' }));

    // The cost row has to name the org's provider, not the platform default.
    // Asserting only the token counts is what let the original bug hide.
    expect(mockRecordLLMUsage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic', model: 'claude-sonnet-4' }),
    );
  });

  it('falls back to the platform defaults when the org configured nothing', async () => {
    orgRow = {
      plan: 'free',
      llmProvider: null,
      llmModel: null,
      llmApiKeyEncrypted: null,
    };
    mockGenerateDashboard.mockResolvedValue({
      title: 'Ingresos',
      description: 'd',
      theme: 'moderno-saas',
      widgets: [],
      usage: { promptTokens: 1, completionTokens: 2 },
    });

    const res = await POST(makeRequest({ prompt: 'ventas', dataSourceId: 'ds-1' }));

    expect(res.status).toBe(201);
    expect(mockAiGateway).toHaveBeenCalledWith('openai', 'gpt-4o', undefined);
  });

  it('uses the org config in edit mode too, not just on create', async () => {
    mockWithOrgContext.mockImplementation(async (...args: unknown[]) => {
      const callback = (typeof args[2] === 'function' ? args[2] : args[3]) as (
        tx: unknown,
      ) => unknown;
      const fakeTx = {
        select: () => ({ from: () => ({ where: () => [orgRow] }) }),
        insert: () => ({ values: () => ({ returning: () => [] }) }),
        update: () => ({
          set: () => ({
            where: () => ({
              returning: () => [{ id: '99999999-9999-9999-9999-999999999999', orgId: 'org-456', title: 'T', widgets: [] }],
            }),
          }),
        }),
        query: {
          dashboards: {
            findFirst: async () => ({
              id: '99999999-9999-9999-9999-999999999999',
              title: 'T',
              description: null,
              widgets: [],
            }),
          },
        },
      };
      return callback(fakeTx);
    });

    mockGenerateNLQAEdit.mockResolvedValue({
      action: 'add',
      widgets: [{ id: 'w1', title: 'MRR', type: 'kpi' }],
      usage: { promptTokens: 5, completionTokens: 5 },
    });

    const res = await POST(
      makeRequest({ prompt: 'agrega MRR', dataSourceId: 'ds-1', dashboardId: '99999999-9999-9999-9999-999999999999' }),
    );

    expect(res.status).toBe(200);
    expect(mockAiGateway).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4', 'encrypted-key-abc');
    expect(mockRecordLLMUsage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic', model: 'claude-sonnet-4' }),
    );
  });
});
