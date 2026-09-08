import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/context';

const {
  mockRequireAuth,
  mockWithOrgContext,
  mockCheckRateLimit,
  mockExplainWidgetData,
  mockAudit,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockWithOrgContext: vi.fn(async (..._args: any[]) => [] as any),
  mockCheckRateLimit: vi.fn().mockReturnValue({ allowed: true, retryAfterSeconds: 0 }),
  mockExplainWidgetData: vi.fn(),
  mockAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/auth/request', () => ({
  requireAuth: mockRequireAuth,
}));

vi.mock('@/db/client', () => ({
  withOrgContext: mockWithOrgContext,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock('@/lib/audit/log', () => ({
  audit: mockAudit,
}));

vi.mock('@/lib/ai/gateway', () => {
  return {
    AiGateway: vi.fn().mockImplementation(() => ({
      explainWidgetData: mockExplainWidgetData,
    })),
  };
});

import { POST } from '@/app/api/widgets/explain/route';

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/widgets/explain', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/widgets/explain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      email: 'user@example.com',
      orgId: 'org-456',
      role: 'editor',
    });
    mockWithOrgContext.mockImplementation(async (...args: unknown[]) => {
      const callback = args[3] as (tx: unknown) => unknown;
      // Mock orgConfig query
        const fakeTx = {
          select: () => ({
            from: () => ({
              where: () => [
                {
                  llmProvider: 'openai',
                  llmModel: 'gpt-4o',
                  llmApiKeyEncrypted: null,
                },
              ],
            }),
          }),
          insert: () => ({
            values: () => ({
              returning: () => [{ id: 'usage-1' }],
            }),
          }),
        };
        return callback(fakeTx);
      },
    );
  });

  it('rejects unauthenticated requests with 401', async () => {
    mockRequireAuth.mockRejectedValueOnce(new UnauthorizedError('No active session'));
    const req = makeRequest({ widgetTitle: 'MRR', widgetType: 'kpi', data: 100 });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects missing widgetTitle or invalid body with 400', async () => {
    const req = makeRequest({ widgetType: 'kpi', data: 100 });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation.invalid_format');
  });

  it('returns 429 when rate limit is exceeded', async () => {
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 15 });
    const req = makeRequest({ widgetTitle: 'MRR', widgetType: 'kpi', data: 100 });
    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('15');
  });

  it('successfully generates explanation and records llm usage', async () => {
    mockExplainWidgetData.mockResolvedValueOnce({
      headline: 'Aumento del 12% en ingresos',
      summary: 'El incremento se debe al cierre de contratos anuales.',
      trend: 'upward',
      keyDrivers: [
        { label: 'Contratos anuales', impact: 'positive', detail: '3 nuevos clientes Enterprise.' },
      ],
      suggestedAction: 'Reforzar el equipo de soporte técnico.',
      usage: { promptTokens: 120, completionTokens: 60 },
    });

    const req = makeRequest({
      widgetTitle: 'Ingresos Netos (MRR)',
      widgetType: 'kpi',
      data: { value: 128400, delta: 12.4 },
      context: {
        dashboardTitle: 'SaaS Analytics',
        timeWindow: 'last_30d',
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.headline).toBe('Aumento del 12% en ingresos');
    expect(body.trend).toBe('upward');
    expect(body.keyDrivers).toHaveLength(1);
    expect(body.suggestedAction).toContain('soporte técnico');

    expect(mockAudit).toHaveBeenCalledWith(
      'org-456',
      'user-123',
      'nlqa.widget_explained',
      'widget:Ingresos Netos (MRR)',
      expect.objectContaining({
        metadata: expect.objectContaining({
          widgetTitle: 'Ingresos Netos (MRR)',
          trend: 'upward',
        }),
      }),
    );
  });
});
