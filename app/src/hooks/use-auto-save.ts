'use client';

import * as React from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import type { Dashboard } from '@/lib/widgets/types';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseAutoSaveResult {
  trigger: (dashboard: Dashboard) => void;
  status: SaveStatus;
  cancel: () => void;
  flush: () => void;
}

/**
 * Canonical serialization of the persisted subset of a dashboard.
 *
 * Shared by `trigger` and the mutation so the value compared against the
 * last save is byte-identical to the value that was actually sent.
 */
function serializeDashboard(dashboard: Dashboard): string {
  return JSON.stringify({
    title: dashboard.title,
    description: dashboard.description,
    theme: dashboard.theme,
    widgets: dashboard.widgets,
    archetype: dashboard.archetype,
    archetypeVariant: dashboard.archetypeVariant,
  });
}

/** A save request: the payload plus the snapshot that describes it. */
interface PendingSave {
  dashboard: Dashboard;
  serialized: string;
}

export function useAutoSave(dashboardId: string, debounceMs = 1000): UseAutoSaveResult {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = React.useState<SaveStatus>('idle');
  const lastSavedRef = React.useRef<string>('');

  const mutation = useMutation({
    mutationFn: async ({ dashboard }: PendingSave) => {
      // The API expects the canonical Dashboard shape. We project
      // `archetype` + `archetypeVariant` so the server can persist them.
      const payload = {
        title: dashboard.title,
        description: dashboard.description,
        theme: dashboard.theme,
        widgets: dashboard.widgets,
        archetype: dashboard.archetype,
        archetypeVariant: dashboard.archetypeVariant,
      };
      const res = await fetch(`/api/dashboards/${dashboardId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = err?.error ?? `HTTP ${res.status}`;
        throw Object.assign(new Error(message), { status: res.status });
      }
      return res.json();
    },
    onMutate: () => {
      setStatus('saving');
    },
    onSuccess: (_data, variables) => {
      setStatus('saved');
      // Record the snapshot that this request carried, not the latest
      // edit: a newer payload may still be in flight, and marking it as
      // persisted would make `trigger` skip it if that request then fails.
      lastSavedRef.current = variables.serialized;
      queryClient.invalidateQueries({ queryKey: ['dashboard', dashboardId] });
      window.setTimeout(() => {
        setStatus((current) => (current === 'saved' ? 'idle' : current));
      }, 1500);
    },
    onError: (err: Error & { status?: number }) => {
      setStatus('error');
      const isConflict = err.status === 409 || err.message?.includes('CONCURRENCY');
      toast({
        variant: 'destructive',
        title: isConflict ? 'Conflicto de edición' : 'No pudimos guardar',
        description: isConflict
          ? 'Otra sesión modificó este dashboard. Recarga la página para ver la versión más reciente.'
          : err.message,
      });
    },
  });

  const debounced = useDebouncedCallback((pending: PendingSave) => {
    mutation.mutate(pending);
  }, debounceMs);

  // A dashboard id change means a different document: the previously
  // persisted snapshot is meaningless, and keeping it makes an identical
  // new dashboard look already-saved (no PATCH, edits lost). The
  // debounce is dropped too, so a pending write cannot land on the old id.
  React.useEffect(() => {
    lastSavedRef.current = '';
    debounced.cancel();
  }, [dashboardId, debounced]);

  const trigger = React.useCallback(
    (dashboard: Dashboard) => {
      const serialized = serializeDashboard(dashboard);
      if (serialized === lastSavedRef.current) return;
      debounced({ dashboard, serialized });
    },
    [debounced],
  );

  const cancel = React.useCallback(() => {
    debounced.cancel();
  }, [debounced]);

  const flush = React.useCallback(() => {
    debounced.flush();
  }, [debounced]);

  return { trigger, status, cancel, flush };
}