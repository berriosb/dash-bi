'use client';

import { useEffect } from 'react';
import { useUIStore } from '@/stores/uiStore';

/**
 * Sync theme (moderno-saas | corporate) y mode (light | dark | system) al DOM.
 *
 * - Setea `data-theme` en <html> según activeTheme
 * - Setea `data-mode` en <html> según activeMode (resolviendo 'system' con prefers-color-scheme)
 *
 * Llamar una sola vez en el root layout.
 */
export function useThemeEffect() {
  const activeTheme = useUIStore((s) => s.activeTheme);
  const activeMode = useUIStore((s) => s.activeMode);

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('data-theme', activeTheme);

    let resolved: 'light' | 'dark';
    if (activeMode === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } else {
      resolved = activeMode;
    }
    html.setAttribute('data-mode', resolved);
    html.style.colorScheme = resolved;
  }, [activeTheme, activeMode]);

  useEffect(() => {
    if (activeMode !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const html = document.documentElement;
      html.setAttribute('data-mode', e.matches ? 'dark' : 'light');
      html.style.colorScheme = e.matches ? 'dark' : 'light';
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [activeMode]);
}