'use client';

import * as React from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useToast } from '@/hooks/use-toast';
import type { Dashboard } from '@/lib/widgets/types';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseAutoSaveResult {
  trigger: (dashboard: Dashboard) => void;
  status: SaveStatus;
  cancel: () => void;
  flush: () => void;
}

export function useAutoSave(dashboardId: string, debounceMs = 1000): UseAutoSaveResult {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = React.useState<SaveStatus>('idle');
  const lastSavedRef = React.useRef<string>('');
  const pendingRef = React.useRef<Dashboard | null>(null);

  const mutation = useMutation({
    mutationFn: async (dashboard: Dashboard) => {
      const res = await fetch(`/api/dashboards/${dashboardId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dashboard),
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
    onSuccess: () => {
      setStatus('saved');
      lastSavedRef.current = JSON.stringify(pendingRef.current);
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
          ? 'Otra sesión modificó este dashboard. Recargá la página para ver la versión más reciente.'
          : err.message,
      });
    },
  });

  const debounced = useDebouncedCallback((dashboard: Dashboard) => {
    pendingRef.current = dashboard;
    mutation.mutate(dashboard);
  }, debounceMs);

  const trigger = React.useCallback(
    (dashboard: Dashboard) => {
      const serialized = JSON.stringify(dashboard);
      if (serialized === lastSavedRef.current) return;
      debounced(dashboard);
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