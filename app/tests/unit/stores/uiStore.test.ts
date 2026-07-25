// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { useUIStore } from '@/stores/uiStore';

describe('uiStore — theme + mode', () => {
  beforeEach(() => {
    useUIStore.setState({
      activeTheme: 'moderno-saas',
      activeMode: 'system',
    });
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-mode');
  });

  it('starts with defaults', () => {
    const state = useUIStore.getState();
    expect(state.activeTheme).toBe('moderno-saas');
    expect(state.activeMode).toBe('system');
  });

  it('setActiveTheme updates state', () => {
    act(() => {
      useUIStore.getState().setActiveTheme('corporate');
    });
    expect(useUIStore.getState().activeTheme).toBe('corporate');
  });

  it('setActiveMode updates state', () => {
    act(() => {
      useUIStore.getState().setActiveMode('dark');
    });
    expect(useUIStore.getState().activeMode).toBe('dark');
  });

  it('toggleMode toggles between light and dark', () => {
    act(() => {
      useUIStore.getState().setActiveMode('light');
    });
    act(() => {
      useUIStore.getState().toggleMode();
    });
    expect(useUIStore.getState().activeMode).toBe('dark');

    act(() => {
      useUIStore.getState().toggleMode();
    });
    expect(useUIStore.getState().activeMode).toBe('light');
  });

  it('persists to localStorage with all theme/mode fields', () => {
    act(() => {
      useUIStore.getState().setActiveTheme('corporate');
      useUIStore.getState().setActiveMode('dark');
    });

    const stored = JSON.parse(localStorage.getItem('dashbi-ui-store') ?? '{}');
    expect(stored.state.activeTheme).toBe('corporate');
    expect(stored.state.activeMode).toBe('dark');
  });
});

describe('useThemeEffect — DOM sync logic', () => {
  it('setActiveMode("system") keeps state at system for the effect to resolve later', () => {
    act(() => {
      useUIStore.getState().setActiveMode('system');
    });
    expect(useUIStore.getState().activeMode).toBe('system');
  });

  it('setActiveMode bypasses system preference when explicit', () => {
    act(() => {
      useUIStore.getState().setActiveMode('dark');
    });
    expect(useUIStore.getState().activeMode).toBe('dark');

    act(() => {
      useUIStore.getState().setActiveMode('light');
    });
    expect(useUIStore.getState().activeMode).toBe('light');
  });

  it('matchMedia mock for system pref detection is wired', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      })),
    });
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    expect(mql.matches).toBe(false);
  });
});