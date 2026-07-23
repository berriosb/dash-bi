/**
 * Catálogo de códigos de error dash-bi.
 *
 * Sprint 1 v0.2: implementación del spec `errors-ux.md §3`.
 * Cada código mapea a un HTTP status y un mensaje user-facing en español.
 *
 * Convenciones:
 * - 1xxx: Auth
 * - 2xxx: Multi-tenant
 * - 3xxx: Validation
 * - 4xxx: Data source / connector
 * - 5xxx: Query
 * - 6xxx: LLM / AI
 * - 7xxx: Export
 * - 8xxx: Public link
 * - 9xxx: Generic
 *
 * Para agregar un código:
 * 1. Agregarlo a ErrorCode union
 * 2. Definir httpStatus + retryable en ERROR_CATALOG (más abajo)
 * 3. Mensaje user-facing por defecto en español (puede ser sobreescrito en messages/es.json)
 */
export type ErrorCode =
  // ───── 1xxx: Auth ─────
  | 'auth.unauthorized'
  | 'auth.forbidden'
  | 'auth.session_expired'
  | 'auth.email_not_verified'
  | 'auth.rate_limited'
  | 'auth.invalid_credentials'
  // ───── 2xxx: Multi-tenant ─────
  | 'tenant.not_member'
  | 'tenant.cross_tenant_access'
  | 'tenant.quota_exceeded'
  // ───── 3xxx: Validation ─────
  | 'validation.required'
  | 'validation.invalid_format'
  | 'validation.too_long'
  | 'validation.too_short'
  | 'validation.out_of_range'
  // ───── 4xxx: Data source / connector ─────
  | 'connector.unreachable'
  | 'connector.timeout'
  | 'connector.invalid_credentials'
  | 'connector.ssrf_blocked'
  | 'connector.rate_limited'
  | 'connector.unsupported_format'
  | 'connector.file_too_large'
  | 'connector.row_limit_exceeded'
  // ───── 5xxx: Query ─────
  | 'query.timeout'
  | 'query.forbidden_keyword'
  | 'query.forbidden_table'
  | 'query.syntax_error'
  | 'query.execution_error'
  | 'query.circuit_open'
  // ───── 6xxx: LLM / AI ─────
  | 'llm.provider_down'
  | 'llm.rate_limited'
  | 'llm.invalid_api_key'
  | 'llm.budget_exceeded'
  | 'llm.json_parse_failed'
  | 'llm.max_retries_exceeded'
  // ───── 7xxx: Export ─────
  | 'export.timeout'
  | 'export.render_failed'
  | 'export.file_too_large'
  | 'export.queue_full'
  // ───── 8xxx: Public link ─────
  | 'share.not_found'
  | 'share.expired'
  | 'share.revoked'
  // ───── 9xxx: Generic ─────
  | 'internal_server_error'
  | 'not_found'
  | 'method_not_allowed'
  | 'payload_too_large';

/**
 * Shape canónico de error que la API retorna al cliente.
 *
 * Ver `errors-ux.md §2.1` para el contrato.
 */
export type AppError = {
  code: ErrorCode;
  message: string;          // user-facing en español
  correlationId: string;    // para soporte
  retryable: boolean;
  details?: Record<string, unknown>;
  fieldErrors?: Record<string, string>;
};

/**
 * Shape para error en widget in-place (dashboard).
 *
 * Ver `errors-ux.md §2.2`.
 */
export type WidgetErrorState = {
  kind: ErrorCode;
  message: string;
  retryable: boolean;
  retryAction?: () => void;
  correlationId?: string;
};

/**
 * Catálogo de errores: code → { httpStatus, retryable, defaultMessage }.
 *
 * defaultMessage es el mensaje por defecto en español. Se puede sobreescribir
 * via `messages/es.json` (Sprint 2 con next-intl).
 */
export const ERROR_CATALOG: Record<ErrorCode, {
  httpStatus: number;
  retryable: boolean;
  defaultMessage: string;
}> = {
  // Auth
  'auth.unauthorized':          { httpStatus: 401, retryable: false, defaultMessage: 'Tu sesión expiró. Volvé a iniciar sesión.' },
  'auth.forbidden':             { httpStatus: 403, retryable: false, defaultMessage: 'No tenés permisos para hacer esto.' },
  'auth.session_expired':       { httpStatus: 401, retryable: false, defaultMessage: 'Tu sesión expiró por inactividad.' },
  'auth.email_not_verified':    { httpStatus: 403, retryable: false, defaultMessage: 'Verificá tu email antes de continuar. Revisá tu casilla.' },
  'auth.rate_limited':          { httpStatus: 429, retryable: true,  defaultMessage: 'Demasiados intentos. Esperá unos minutos.' },
  'auth.invalid_credentials':   { httpStatus: 401, retryable: false, defaultMessage: 'Email o contraseña incorrectos.' },

  // Multi-tenant
  'tenant.not_member':          { httpStatus: 403, retryable: false, defaultMessage: 'No sos miembro de esta organización.' },
  'tenant.cross_tenant_access': { httpStatus: 403, retryable: false, defaultMessage: 'Acceso denegado.' },
  'tenant.quota_exceeded':      { httpStatus: 402, retryable: false, defaultMessage: 'Alcanzaste el límite de tu plan.' },

  // Validation
  'validation.required':        { httpStatus: 400, retryable: false, defaultMessage: 'Este campo es obligatorio.' },
  'validation.invalid_format':  { httpStatus: 400, retryable: false, defaultMessage: 'Formato inválido.' },
  'validation.too_long':        { httpStatus: 400, retryable: false, defaultMessage: 'Texto demasiado largo.' },
  'validation.too_short':       { httpStatus: 400, retryable: false, defaultMessage: 'Texto demasiado corto.' },
  'validation.out_of_range':    { httpStatus: 400, retryable: false, defaultMessage: 'Valor fuera de rango.' },

  // Connector
  'connector.unreachable':      { httpStatus: 502, retryable: true,  defaultMessage: 'No pudimos conectar con la fuente de datos.' },
  'connector.timeout':          { httpStatus: 504, retryable: true,  defaultMessage: 'La consulta tardó demasiado.' },
  'connector.invalid_credentials': { httpStatus: 401, retryable: false, defaultMessage: 'Credenciales inválidas.' },
  'connector.ssrf_blocked':     { httpStatus: 400, retryable: false, defaultMessage: 'Esta URL no está permitida por seguridad.' },
  'connector.rate_limited':     { httpStatus: 429, retryable: true,  defaultMessage: 'El proveedor limitó las requests.' },
  'connector.unsupported_format': { httpStatus: 400, retryable: false, defaultMessage: 'Formato no soportado.' },
  'connector.file_too_large':   { httpStatus: 413, retryable: false, defaultMessage: 'Archivo demasiado grande.' },
  'connector.row_limit_exceeded': { httpStatus: 400, retryable: false, defaultMessage: 'Demasiadas filas en el archivo.' },

  // Query
  'query.timeout':              { httpStatus: 504, retryable: true,  defaultMessage: 'La consulta excedió los 30s.' },
  'query.forbidden_keyword':    { httpStatus: 400, retryable: false, defaultMessage: 'Operación no permitida.' },
  'query.forbidden_table':      { httpStatus: 403, retryable: false, defaultMessage: 'Sin acceso a esa tabla.' },
  'query.syntax_error':         { httpStatus: 400, retryable: true,  defaultMessage: 'La consulta tiene un error de sintaxis.' },
  'query.execution_error':      { httpStatus: 500, retryable: true,  defaultMessage: 'Error al ejecutar la consulta.' },
  'query.circuit_open':         { httpStatus: 503, retryable: true,  defaultMessage: 'Conector temporalmente deshabilitado.' },

  // LLM
  'llm.provider_down':          { httpStatus: 502, retryable: true,  defaultMessage: 'El proveedor de IA no responde.' },
  'llm.rate_limited':           { httpStatus: 429, retryable: true,  defaultMessage: 'Demasiadas consultas a la IA.' },
  'llm.invalid_api_key':        { httpStatus: 401, retryable: false, defaultMessage: 'Tu API key es inválida.' },
  'llm.budget_exceeded':        { httpStatus: 402, retryable: false, defaultMessage: 'Alcanzaste tu límite de tokens.' },
  'llm.json_parse_failed':      { httpStatus: 500, retryable: true,  defaultMessage: 'La IA devolvió una respuesta inválida.' },
  'llm.max_retries_exceeded':   { httpStatus: 500, retryable: false, defaultMessage: 'No pudimos generar el dashboard después de varios intentos.' },

  // Export
  'export.timeout':             { httpStatus: 504, retryable: true,  defaultMessage: 'La exportación tardó demasiado.' },
  'export.render_failed':       { httpStatus: 500, retryable: true,  defaultMessage: 'Error al generar el PDF.' },
  'export.file_too_large':      { httpStatus: 413, retryable: false, defaultMessage: 'El dashboard es demasiado grande para exportar.' },
  'export.queue_full':          { httpStatus: 503, retryable: true,  defaultMessage: 'Hay muchas exportaciones en cola.' },

  // Public link
  'share.not_found':            { httpStatus: 404, retryable: false, defaultMessage: 'Este enlace no existe o fue eliminado.' },
  'share.expired':              { httpStatus: 410, retryable: false, defaultMessage: 'Este enlace expiró.' },
  'share.revoked':              { httpStatus: 410, retryable: false, defaultMessage: 'Este enlace fue revocado.' },

  // Generic
  'internal_server_error':      { httpStatus: 500, retryable: true,  defaultMessage: 'Algo salió mal. Probá de nuevo o contactá soporte.' },
  'not_found':                  { httpStatus: 404, retryable: false, defaultMessage: 'Recurso no encontrado.' },
  'method_not_allowed':         { httpStatus: 405, retryable: false, defaultMessage: 'Método no permitido.' },
  'payload_too_large':          { httpStatus: 413, retryable: false, defaultMessage: 'La solicitud es demasiado grande.' },
};

/**
 * Mapea ErrorCode → HTTP status code.
 */
export function statusFromCode(code: ErrorCode): number {
  return ERROR_CATALOG[code]?.httpStatus ?? 500;
}

/**
 * Custom error class para errores dash-bi.
 *
 * Útil cuando quieres lanzar errores tipados desde el código de negocio
 * y que `toUserError` los mapee correctamente.
 */
export class AppErrorException extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: Record<string, unknown>,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message ?? ERROR_CATALOG[code]?.defaultMessage ?? 'Error');
    this.name = 'AppErrorException';
  }
}