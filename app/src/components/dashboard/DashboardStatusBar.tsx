'use client';

import * as React from 'react';
import { Check, Loader2, AlertCircle, Pencil } from 'lucide-react';
import type { SaveStatus } from '@/hooks/use-auto-save';

interface DashboardStatusBarProps {
  status: SaveStatus;
  isEditing: boolean;
}

export function DashboardStatusBar({ status, isEditing }: DashboardStatusBarProps) {
  return (
    <div className="dashboard-status-bar" role="status" aria-live="polite">
      {isEditing && (
        <span className="dashboard-status-bar__chip dashboard-status-bar__chip--editing">
          <Pencil className="w-3 h-3" />
          Editando
        </span>
      )}
      <SaveStatusIndicator status={status} />
    </div>
  );
}

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  switch (status) {
    case 'saving':
      return (
        <span className="dashboard-status-bar__chip dashboard-status-bar__chip--saving">
          <Loader2 className="w-3 h-3 animate-spin" />
          Guardando
        </span>
      );
    case 'saved':
      return (
        <span className="dashboard-status-bar__chip dashboard-status-bar__chip--saved">
          <Check className="w-3 h-3" />
          Guardado
        </span>
      );
    case 'error':
      return (
        <span className="dashboard-status-bar__chip dashboard-status-bar__chip--error">
          <AlertCircle className="w-3 h-3" />
          Error al guardar
        </span>
      );
    default:
      return null;
  }
}