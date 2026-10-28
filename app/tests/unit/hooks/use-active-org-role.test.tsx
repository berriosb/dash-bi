// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { useActiveOrgRole } from '@/hooks/use-active-org-role';
import { useUIStore } from '@/stores/uiStore';

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

const ORGS_PAYLOAD = {
  organizations: [
    { id: 'org-a', name: 'Org A', slug: 'a', plan: 'pro', role: 'viewer' },
    { id: 'org-b', name: 'Org B', slug: 'b', plan: 'pro', role: 'admin' },
  ],
  activeOrgId: 'org-a',
};

function mockOrgsFetch(payload: unknown = ORGS_PAYLOAD, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 401,
    json: async () => payload,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('useActiveOrgRole', () => {
  beforeEach(() => {
    // El store persiste en localStorage: sin esto, el estado de un test
    // filtra al siguiente.
    useUIStore.setState({ activeOrgId: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resuelve el rol de la organización activa del store', async () => {
    mockOrgsFetch();
    useUIStore.setState({ activeOrgId: 'org-b' });

    const { result } = renderHook(() => useActiveOrgRole(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.role).toBe('admin'));
  });

  it('cae en la organización activa del servidor cuando el store está vacío', async () => {
    mockOrgsFetch();
    useUIStore.setState({ activeOrgId: null });

    const { result } = renderHook(() => useActiveOrgRole(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.role).toBe('viewer'));
  });

  it('devuelve rol null cuando la consulta falla (visitante sin sesión)', async () => {
    mockOrgsFetch({}, false);

    const { result } = renderHook(() => useActiveOrgRole(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.role).toBeNull();
  });
});
