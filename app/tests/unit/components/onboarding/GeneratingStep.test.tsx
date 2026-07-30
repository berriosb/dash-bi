// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockFetch = vi.fn();

vi.mock('@/stores/onboardingStore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return actual;
});

import { GeneratingStep } from '@/components/onboarding/GeneratingStep';
import { useOnboardingStore } from '@/stores/onboardingStore';

describe('GeneratingStep', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useOnboardingStore.getState().reset();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  it('shows a loading message while the API call is in flight', () => {
    useOnboardingStore.getState().setSelectedSourceType('stripe');
    useOnboardingStore.getState().setDataSourceId('550e8400-e29b-41d4-a716-446655440000');
    useOnboardingStore.getState().setPrompt('Mostrame revenue mensual');

    mockFetch.mockImplementationOnce(() => new Promise(() => {}));

    render(<GeneratingStep />);
    expect(screen.getByText(/generando.*dashboard/i)).toBeDefined();
  });

  it('calls POST /api/dashboards/generate with prompt and dataSourceId', async () => {
    useOnboardingStore.getState().setSelectedSourceType('stripe');
    useOnboardingStore.getState().setDataSourceId('550e8400-e29b-41d4-a716-446655440000');
    useOnboardingStore.getState().setPrompt('Mostrame revenue mensual');
    useOnboardingStore.getState().goToStep('generating');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ dashboardId: 'dash-uuid-1', action: 'created' }),
    });

    render(<GeneratingStep />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const firstCall = mockFetch.mock.calls[0];
    expect(firstCall).toBeDefined();
    const url = firstCall![0] as string;
    const init = firstCall![1] as RequestInit;
    expect(url).toBe('/api/dashboards/generate');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      prompt: 'Mostrame revenue mensual',
      dataSourceId: '550e8400-e29b-41d4-a716-446655440000',
    });
  });

  it('sets dashboardId in the store and moves to success step on success', async () => {
    useOnboardingStore.getState().setSelectedSourceType('stripe');
    useOnboardingStore.getState().setDataSourceId('550e8400-e29b-41d4-a716-446655440000');
    useOnboardingStore.getState().setPrompt('Mostrame revenue mensual');
    useOnboardingStore.getState().goToStep('generating');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ dashboardId: 'dash-uuid-1', action: 'created' }),
    });

    render(<GeneratingStep />);

    await waitFor(() => {
      expect(useOnboardingStore.getState().step).toBe('success');
    });
    expect(useOnboardingStore.getState().dashboardId).toBe('dash-uuid-1');
  });

  it('shows an error and a retry option when the API call fails', async () => {
    useOnboardingStore.getState().setSelectedSourceType('stripe');
    useOnboardingStore.getState().setDataSourceId('550e8400-e29b-41d4-a716-446655440000');
    useOnboardingStore.getState().setPrompt('Mostrame revenue');
    useOnboardingStore.getState().goToStep('generating');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'AI provider rate limited' }),
    });

    render(<GeneratingStep />);

    await waitFor(() => {
      expect(screen.getByText(/AI provider rate limited/i)).toBeDefined();
    });
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeDefined();
  });

  it('fires generation_failed tracking event when fetch rejects with a network error', async () => {
    useOnboardingStore.getState().setSelectedSourceType('stripe');
    useOnboardingStore.getState().setDataSourceId('550e8400-e29b-41d4-a716-446655440000');
    useOnboardingStore.getState().setPrompt('Mostrame revenue');
    useOnboardingStore.getState().goToStep('generating');

    // First call: generate endpoint rejects (network error)
    mockFetch.mockRejectedValueOnce(new Error('Network down'));

    render(<GeneratingStep />);

    await waitFor(() => {
      expect(screen.getByText(/Network down/i)).toBeDefined();
    });

    // Second call: the analytics tracking fetch to /api/onboarding/track
    const trackCall = mockFetch.mock.calls.find((c) => c[0] === '/api/onboarding/track');
    expect(trackCall).toBeDefined();
    const init = trackCall![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'generation_failed',
      error: 'Network down',
      attempt: 0,
    });
  });

  it('clicking Reintentar after an error calls fetch again', async () => {
    useOnboardingStore.getState().setSelectedSourceType('stripe');
    useOnboardingStore.getState().setDataSourceId('550e8400-e29b-41d4-a716-446655440000');
    useOnboardingStore.getState().setPrompt('Mostrame revenue');
    useOnboardingStore.getState().goToStep('generating');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'temporary' }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ dashboardId: 'dash-uuid-2', action: 'created' }),
    });

    render(<GeneratingStep />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reintentar/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
    expect(useOnboardingStore.getState().dashboardId).toBe('dash-uuid-2');
  });
});