import { describe, it, expect, beforeEach } from 'vitest';
import { useOnboardingStore, type OnboardingStep } from '@/stores/onboardingStore';

describe('onboardingStore', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
  });

  it('starts at the welcome step with empty selections', () => {
    const state = useOnboardingStore.getState();
    expect(state.step).toBe('welcome');
    expect(state.selectedSourceType).toBeNull();
    expect(state.dataSourceId).toBeNull();
    expect(state.prompt).toBe('');
    expect(state.dashboardId).toBeNull();
    expect(state.isGenerating).toBe(false);
  });

  it('advances to a specific step via goToStep', () => {
    const store = useOnboardingStore.getState();
    store.goToStep('choose_source');
    expect(useOnboardingStore.getState().step).toBe('choose_source');

    useOnboardingStore.getState().goToStep('prompt');
    expect(useOnboardingStore.getState().step).toBe('prompt');
  });

  it('records selected data source type when user picks one', () => {
    useOnboardingStore.getState().setSelectedSourceType('stripe');
    expect(useOnboardingStore.getState().selectedSourceType).toBe('stripe');
  });

  it('records the data source id when the connection wizard completes', () => {
    useOnboardingStore.getState().setDataSourceId('ds-uuid-1');
    expect(useOnboardingStore.getState().dataSourceId).toBe('ds-uuid-1');
  });

  it('updates the prompt text as the user types', () => {
    useOnboardingStore.getState().setPrompt('Top 10 clientes');
    expect(useOnboardingStore.getState().prompt).toBe('Top 10 clientes');
  });

  it('toggles generating flag while AI render is in flight', () => {
    useOnboardingStore.getState().setGenerating(true);
    expect(useOnboardingStore.getState().isGenerating).toBe(true);

    useOnboardingStore.getState().setGenerating(false);
    expect(useOnboardingStore.getState().isGenerating).toBe(false);
  });

  it('records the generated dashboard id and moves to success step', () => {
    const store = useOnboardingStore.getState();
    store.setDashboardId('dash-uuid-1');
    store.goToStep('success');

    const state = useOnboardingStore.getState();
    expect(state.dashboardId).toBe('dash-uuid-1');
    expect(state.step).toBe('success');
  });

  it('reset clears all fields back to initial state', () => {
    const store = useOnboardingStore.getState();
    store.setSelectedSourceType('postgres');
    store.setDataSourceId('ds-1');
    store.setPrompt('test');
    store.setDashboardId('dash-1');
    store.goToStep('success');

    useOnboardingStore.getState().reset();
    const state = useOnboardingStore.getState();
    expect(state.step).toBe('welcome');
    expect(state.selectedSourceType).toBeNull();
    expect(state.dataSourceId).toBeNull();
    expect(state.prompt).toBe('');
    expect(state.dashboardId).toBeNull();
  });

  it('exposes the typed step enum (compile-time check)', () => {
    // The union type should be exactly: 'welcome' | 'choose_source' | 'prompt' | 'generating' | 'success'
    const steps: OnboardingStep[] = ['welcome', 'choose_source', 'prompt', 'generating', 'success'];
    expect(steps).toHaveLength(5);
  });
});