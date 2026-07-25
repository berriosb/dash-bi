'use client';

import type { AppError, WidgetErrorState as WidgetErrorStateType } from '@/lib/errors/types';

interface ErrorStateProps {
  error: AppError;
  onRetry?: () => void;
  onDismiss?: () => void;
}

/**
 * Componente reutilizable para mostrar errores en la UI.
 *
 * Sprint 1 v0.2: implementación del spec `errors-ux.md §5`.
 * Usar en:
 * - Toast notifications (variant="inline")
 * - Páginas completas (variant="page")
 * - Inline forms (variant="inline")
 *
 * El correlation ID se muestra en dev mode para facilitar debugging.
 * En producción NO se muestra (por seguridad — el correlation ID se loguea server-side).
 */
export function ErrorState({ error, onRetry, onDismiss }: ErrorStateProps) {
  const isDev = process.env.NODE_ENV !== 'production';

  return (
    <div className="error-state" role="alert" aria-live="polite">
      <div className="error-icon">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>

      <div className="error-body">
        <p className="error-message">{error.message}</p>

        {error.fieldErrors && Object.keys(error.fieldErrors).length > 0 && (
          <ul className="error-field-list">
            {Object.entries(error.fieldErrors).map(([field, msg]) => (
              <li key={field}>
                <strong>{field}:</strong> {msg}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="error-actions">
        {error.retryable && onRetry && (
          <button type="button" onClick={onRetry} className="btn-retry">
            Reintentar
          </button>
        )}
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="btn-dismiss">
            Cerrar
          </button>
        )}
      </div>

      {isDev && (
        <code className="error-correlation">ID: {error.correlationId}</code>
      )}
    </div>
  );
}

/**
 * Componente específico para errores de widget in-place en el dashboard.
 * Más liviano que ErrorState (no fieldErrors, tiene retryAction callback).
 */
export function WidgetErrorState({
  error,
}: {
  error: WidgetErrorStateType;
}) {
  return (
    <div className="widget-error" role="alert">
      <div className="widget-error-icon">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>

      <p className="widget-error-message">{error.message}</p>

      {error.retryable && error.retryAction && (
        <button
          type="button"
          onClick={error.retryAction}
          className="widget-error-retry"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}