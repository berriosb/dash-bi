// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAutoSave } from '@/hooks/use-auto-save';
import type { Dashboard } from '@/lib/widgets/types';
import * as React from 'react';

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return Wrapper;
}

const mockDashboard: Dashboard = {
  title: 'Test',
  description: 'desc',
  theme: 'moderno-saas',
  widgets: [],
  archetype: 'kpi-grid',
  archetypeVariant: {
    density: 'balanced',
    accent: 'default',
    timeWindow: 'last_30d',
    comparativo: 'previous_period',
  },
};

describe('useAutoSave', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not call fetch if serialized payload is unchanged', async () => {
    const { result } = renderHook(() => useAutoSave('dash-1'), { wrapper: makeWrapper() });

    act(() => {
      result.current.trigger(mockDashboard);
    });
    await new Promise((r) => setTimeout(r, 50));

    act(() => {
      result.current.trigger(mockDashboard);
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls PATCH when payload changes', async () => {
    const { result } = renderHook(() => useAutoSave('dash-1'), { wrapper: makeWrapper() });

    act(() => {
      result.current.trigger({ ...mockDashboard, title: 'Updated' });
    });
    await new Promise((r) => setTimeout(r, 1100));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/dashboards/dash-1');
    expect(init?.method).toBe('PATCH');
    const body = JSON.parse(init?.body);
    expect(body.title).toBe('Updated');
    // Sprint 1.5: archetype + variant are round-tripped in the PATCH body.
    expect(body.archetype).toBe('kpi-grid');
    expect(body.archetypeVariant.density).toBe('balanced');
  });

  it('exposes idle/saved status lifecycle', async () => {
    const { result } = renderHook(() => useAutoSave('dash-1', 100), { wrapper: makeWrapper() });

    expect(result.current.status).toBe('idle');

    act(() => {
      result.current.trigger({ ...mockDashboard, title: 'A' });
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(['saving', 'saved', 'idle']).toContain(result.current.status);
  });
});