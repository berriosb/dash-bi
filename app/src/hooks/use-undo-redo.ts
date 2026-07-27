'use client';

import * as React from 'react';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useUIStore } from '@/stores/uiStore';

export interface UseUndoRedoResult {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useUndoRedo(): UseUndoRedoResult {
  const temporalStore = useDashboardStore.temporal.getState();
  const pastStates = temporalStore.pastStates;
  const futureStates = temporalStore.futureStates;

  const undo = React.useCallback(() => {
    useDashboardStore.temporal.getState().undo();
  }, []);

  const redo = React.useCallback(() => {
    useDashboardStore.temporal.getState().redo();
  }, []);

  return {
    undo,
    redo,
    canUndo: pastStates.length > 0,
    canRedo: futureStates.length > 0,
  };
}

export function useDashboardKeyboardShortcuts(): void {
  const { undo, redo } = useUndoRedo();
  const setSelectedWidgetId = useUIStore((s) => s.setSelectedWidgetId);

  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isEditingField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      if (isEditingField) return;

      const isMod = e.metaKey || e.ctrlKey;

      if (isMod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (isMod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.key === 'Escape') {
        setSelectedWidgetId(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, setSelectedWidgetId]);
}