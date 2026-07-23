# Spec: Errors UX (Catálogo consolidado)

> Catálogo único de errores que la UI puede mostrar al usuario. Hoy cada spec maneja errores ad-hoc (`toWidgetError`, `userMessage(error)`, `widget error state`…). Este spec consolida los shapes, copy en español, y comportamiento esperado. Cierra gap detectado en análisis 2026-07-22.

**Status:** Draft v0.1
**Prioridad:** P1 — sin esto la UX de error es inconsistente entre features
**Responsable:** codehak
**Depende de:** todas las features

---

## Cambios respecto a v0.1

> Primera versión. Crea contrato único entre backend y frontend.

---

## 1. Objetivo

Que cada error que llega al cliente tenga:

1. **Código estable** (`query_timeout`, `connector_unreachable`, etc.) que el frontend puede mapear a UI sin parsear strings
2. **Mensaje user-friendly** en español, sin stack traces ni detalles internos
3. **`correlationId`** para que soporte pueda buscar el error en logs
4. **`retryable`** boolean para que UI sepa si mostrar botón "Reintentar"
5. **`fieldErrors`** opcional para forms (validation por campo)

---

## 2. Shape canónico de error

### 2.1 HTTP errors (REST API)

```typescript
// lib/errors/types.ts

export type ErrorCode =
  // Auth (1xxx)
  | 'auth.unauthorized'
  | 'auth.forbidden'
  | 'auth.session_expired'
  | 'auth.email_not_verified'
  | 'auth.rate_limited'
  | 'auth.invalid_credentials'
  // Multi-tenant (2xxx)
  | 'tenant.not_member'
  | 'tenant.cross_tenant_access'
  | 'tenant.quota_exceeded'
  // Validation (3xxx)
  | 'validation.required'
  | 'validation.invalid_format'
  | 'validation.too_long'
  | 'validation.too_short'
  // Data source / connector (4xxx)
  | 'connector.unreachable'
  | 'connector.timeout'
  | 'connector.invalid_credentials'
  | 'connector.ssrf_blocked'
  | 'connector.rate_limited'
  | 'connector.unsupported_format'
  | 'connector.file_too_large'
  | 'connector.row_limit_exceeded'
  // Query (5xxx)
  | 'query.timeout'
  | 'query.forbidden_keyword'
  | 'query.forbidden_table'
  | 'query.syntax_error'
  | 'query.execution_error'
  | 'query.circuit_open'
  // LLM / AI (6xxx)
  | 'llm.provider_down'
  | 'llm.rate_limited'
  | 'llm.invalid_api_key'
  | 'llm.budget_exceeded'
  | 'llm.json_parse_failed'
  | 'llm.max_retries_exceeded'
  // Export (7xxx)
  | 'export.timeout'
  | 'export.render_failed'
  | 'export.file_too_large'
  | 'export.queue_full'
  // Public link (8xxx)
  | 'share.not_found'
  | 'share.expired'
  | 'share.revoked'
  // Generic (9xxx)
  | 'internal_server_error'
  | 'not_found'
  | 'method_not_allowed'
  | 'payload_too_large';

export type AppError = {
  code: ErrorCode;
  message: string;          // user-facing en español
  correlationId: string;    // para soporte
  retryable: boolean;
  details?: Record<string, unknown>;  // opcional, contextual
  fieldErrors?: Record<string, string>;  // solo para validation errors en forms
};
```

### 2.2 Widget error state (in-place en el dashboard)

```typescript
// lib/errors/widget-error.ts

export type WidgetErrorState = {
  kind: ErrorCode;
  message: string;          // user-facing en español
  retryable: boolean;
  retryAction?: () => void;  // callback que se llama al click "Reintentar"
  correlationId?: string;
};

// Ejemplo de render
function WidgetError({ error }: { error: WidgetErrorState }) {
  return (
    <Card>
      <AlertTriangle />
      <Title>No se pudo cargar este widget</Title>
      <Message>{error.message}</Message>
      {error.retryable && <Button onClick={error.retryAction}>Reintentar</Button>}
      <Subtle>ID: {error.correlationId}</Subtle>
    </Card>
  );
}
```

### 2.3 Streaming errors (NLQA SSE)

```typescript
// En el evento SSE
type NLQAEvent = 
  | { kind: 'thinking' }
  | ...
  | { kind: 'error'; code: ErrorCode; message: string; retryable: boolean; correlationId: string };
```

---

## 3. Catálogo completo

### 3.1 Auth (1xxx)

| Code | HTTP | Message (es) | Retryable | UI |
|------|------|--------------|-----------|-----|
| `auth.unauthorized` | 401 | "Tu sesión expiró. Volvé a iniciar sesión." | true | Redirect a /login |
| `auth.forbidden` | 403 | "No tenés permisos para hacer esto." | false | Toast error |
| `auth.session_expired` | 401 | "Tu sesión expiró por inactividad." | true | Toast + redirect a /login |
| `auth.email_not_verified` | 403 | "Verificá tu email antes de continuar. Revisá tu casilla." | false | Toast con link "Reenviar email" |
| `auth.rate_limited` | 429 | "Demasiados intentos. Esperá {minutes} minutos." | true (después de N min) | Toast con countdown |
| `auth.invalid_credentials` | 401 | "Email o contraseña incorrectos." | false | Form field error |

### 3.2 Multi-tenant (2xxx)

| Code | HTTP | Message | Retryable | UI |
|------|------|---------|-----------|-----|
| `tenant.not_member` | 403 | "No sos miembro de esta organización." | false | Toast + redirect a org switcher |
| `tenant.cross_tenant_access` | 403 | "Acceso denegado." (genérico por seguridad) | false | Toast + log SECURITY event |
| `tenant.quota_exceeded` | 402 | "Alcanzaste el límite de tu plan. [Actualizar plan →]" | false | Modal con CTA |

### 3.3 Validation (3xxx)

| Code | HTTP | Message | Retryable | UI |
|------|------|---------|-----------|-----|
| `validation.required` | 400 | "Este campo es obligatorio." | false | Field error inline |
| `validation.invalid_format` | 400 | "Formato inválido." | false | Field error inline |
| `validation.too_long` | 400 | "Máximo {max} caracteres." | false | Field error inline |
| `validation.too_short` | 400 | "Mínimo {min} caracteres." | false | Field error inline |

**Forma para forms:**

```json
{
  "code": "validation.required",
  "message": "Revisá los campos marcados.",
  "correlationId": "req_abc123",
  "retryable": false,
  "fieldErrors": {
    "email": "Email inválido",
    "password": "Mínimo 8 caracteres"
  }
}
```

### 3.4 Data source / connector (4xxx)

| Code | HTTP | Message | Retryable | UI |
|------|------|---------|-----------|-----|
| `connector.unreachable` | 502 | "No pudimos conectar con {dataSourceName}. Verificá que esté accesible." | true | Widget error + Data source badge |
| `connector.timeout` | 504 | "La consulta tardó demasiado. Probá de nuevo o contactá soporte." | true | Widget error |
| `connector.invalid_credentials` | 401 | "Las credenciales de {dataSourceName} son inválidas. [Reconfigurar →]" | false | Data source badge rojo + CTA |
| `connector.ssrf_blocked` | 400 | "Esta URL no está permitida por seguridad." | false | Form error en wizard |
| `connector.rate_limited` | 429 | "El proveedor limitó las requests. Esperá unos minutos." | true | Toast con countdown |
| `connector.unsupported_format` | 400 | "Formato de archivo no soportado. Usá CSV, XLSX o TSV." | false | Upload wizard error |
| `connector.file_too_large` | 413 | "El archivo es demasiado grande ({size}MB). Máximo {max}MB." | false | Upload wizard error |
| `connector.row_limit_exceeded` | 400 | "El archivo tiene {rows} filas. Máximo {max}." | false | Upload wizard error |

### 3.5 Query (5xxx)

| Code | HTTP | Message | Retryable | UI |
|------|------|---------|-----------|-----|
| `query.timeout` | 504 | "La consulta excedió los 30s. Refiná los filtros." | true | Widget error |
| `query.forbidden_keyword` | 400 | "La consulta contiene operaciones no permitidas." | false | Widget error (genérico por seguridad) |
| `query.forbidden_table` | 403 | "No tenés acceso a esa tabla." | false | Widget error |
| `query.syntax_error` | 400 | "La consulta tiene un error de sintaxis." | true (regenerar) | Widget error |
| `query.execution_error` | 500 | "Error al ejecutar la consulta." | true | Widget error |
| `query.circuit_open` | 503 | "El conector está temporalmente deshabilitado por errores repetidos. Probá en 5 min." | true (con delay) | Toast + Data source badge |

### 3.6 LLM / AI (6xxx)

| Code | HTTP | Message | Retryable | UI |
|------|------|---------|-----------|-----|
| `llm.provider_down` | 502 | "El proveedor de IA no responde. Probá de nuevo en unos minutos." | true | Chat panel error + retry |
| `llm.rate_limited` | 429 | "Demasiadas consultas a la IA. Esperá unos minutos." | true (con countdown) | Chat panel error |
| `llm.invalid_api_key` | 401 | "Tu API key de {provider} es inválida. [Configurar →]" | false | Settings banner |
| `llm.budget_exceeded` | 402 | "Alcanzaste tu límite de tokens. [Actualizar plan →]" | false | Modal con CTA |
| `llm.json_parse_failed` | 500 | "La IA devolvió una respuesta inválida. Probá reformular." | true | Chat panel + retry automático (max 3) |
| `llm.max_retries_exceeded` | 500 | "No pudimos generar el dashboard después de varios intentos. Reformulá tu pedido." | false | Chat panel + opción "Reformular" |

### 3.7 Export (7xxx)

| Code | HTTP | Message | Retryable | UI |
|------|------|---------|-----------|-----|
| `export.timeout` | 504 | "La exportación tardó demasiado. Probá de nuevo." | true | Export dialog error |
| `export.render_failed` | 500 | "Error al generar el PDF. Contactá soporte si persiste." | true | Export dialog error |
| `export.file_too_large` | 413 | "El dashboard es demasiado grande para exportar." | false | Export dialog warning |
| `export.queue_full` | 503 | "Hay muchas exportaciones en cola. Esperá unos minutos." | true | Export dialog + countdown |

### 3.8 Public link (8xxx)

| Code | HTTP | Message | Retryable | UI |
|------|------|---------|-----------|-----|
| `share.not_found` | 404 | "Este enlace no existe o fue eliminado." | false | Página "No encontrado" |
| `share.expired` | 410 | "Este enlace expiró." | false | Página "Expirado" |
| `share.revoked` | 410 | "Este enlace fue revocado por el propietario." | false | Página "Revocado" |

### 3.9 Generic (9xxx)

| Code | HTTP | Message | Retryable | UI |
|------|------|---------|-----------|-----|
| `internal_server_error` | 500 | "Algo salió mal. Probá de nuevo o contactá soporte." | true | Toast + correlation ID |
| `not_found` | 404 | "Recurso no encontrado." | false | Página 404 |
| `method_not_allowed` | 405 | "Método no permitido." | false | (raro, error genérico) |
| `payload_too_large` | 413 | "La solicitud es demasiado grande." | false | Toast error |

---

## 4. Helper `toUserError`

```typescript
// lib/errors/to-user-error.ts

export function toUserError(err: unknown, correlationId: string): AppError {
  // 1. Si ya es AppError, devolver tal cual
  if (err instanceof AppErrorImpl) return err.toJSON();

  // 2. Si es un ValidationError de Zod
  if (err instanceof ZodError) {
    return {
      code: 'validation.invalid_format',
      message: 'Revisá los campos marcados.',
      correlationId,
      retryable: false,
      fieldErrors: zodToFieldErrors(err),
    };
  }

  // 3. Si es un error conocido del query-engine
  if (err instanceof QueryTimeoutError) return makeError('query.timeout', correlationId);
  if (err instanceof QueryForbiddenKeywordError) return makeError('query.forbidden_keyword', correlationId);
  if (err instanceof ConnectorUnreachableError) return makeError('connector.unreachable', correlationId, { dataSourceName: err.dataSourceName });
  // ... etc

  // 4. Error genérico
  log.error({ err, correlationId }, 'Unhandled error');
  return {
    code: 'internal_server_error',
    message: 'Algo salió mal. Probá de nuevo o contactá soporte.',
    correlationId,
    retryable: true,
  };
}
```

### 4.1 Uso en API route

```typescript
// app/api/dashboards/generate/route.ts
export async function POST(req: Request) {
  const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID();
  
  try {
    // ... lógica
  } catch (err) {
    const appError = toUserError(err, correlationId);
    log.error({ err, correlationId, code: appError.code }, 'dashboard.generate failed');
    return Response.json(appError, { status: statusFromCode(appError.code) });
  }
}

function statusFromCode(code: ErrorCode): number {
  if (code.startsWith('auth.')) return 401;
  if (code.startsWith('tenant.cross_tenant')) return 403;
  if (code.startsWith('validation.')) return 400;
  if (code.startsWith('query.timeout')) return 504;
  // ... etc
  return 500;
}
```

---

## 5. Frontend: componente `<ErrorState>`

```tsx
// components/errors/ErrorState.tsx

type Props = {
  error: AppError;
  onRetry?: () => void;
  onDismiss?: () => void;
  variant?: 'inline' | 'toast' | 'modal' | 'page';
};

export function ErrorState({ error, onRetry, onDismiss, variant = 'inline' }: Props) {
  const t = useTranslations('errors');
  const code = t(error.code);  // i18n lookup

  return (
    <div className={`error-state error-state--${variant}`}>
      <Icon name={iconForCode(error.code)} />
      <div>
        <p className="error-message">{code.message ?? error.message}</p>
        {error.fieldErrors && (
          <ul className="error-field-list">
            {Object.entries(error.fieldErrors).map(([field, msg]) => (
              <li key={field}><strong>{field}:</strong> {msg}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="error-actions">
        {error.retryable && onRetry && (
          <Button variant="outline" onClick={onRetry}>Reintentar</Button>
        )}
        {onDismiss && (
          <Button variant="ghost" onClick={onDismiss}>Cerrar</Button>
        )}
      </div>
      {process.env.NODE_ENV !== 'production' && (
        <code className="error-correlation">ID: {error.correlationId}</code>
      )}
    </div>
  );
}
```

---

## 6. i18n (estructura preparada)

Aunque MVP es monolingüe español, se estructura `messages/es.json` para preparar Fase 2:

```json
// messages/es.json
{
  "errors": {
    "auth.unauthorized": { "message": "Tu sesión expiró. Volvé a iniciar sesión." },
    "auth.invalid_credentials": { "message": "Email o contraseña incorrectos." },
    "tenant.quota_exceeded": { "message": "Alcanzaste el límite de tu plan." },
    "query.timeout": { "message": "La consulta excedió los 30s. Refiná los filtros." },
    "llm.max_retries_exceeded": { "message": "No pudimos generar el dashboard después de varios intentos. Reformulá tu pedido." }
    // ... etc
  }
}
```

Fase 2: agregar `messages/en.json` + integrar `next-intl`.

---

## 7. Logging con correlationId

```typescript
// lib/logger.ts

const logger = pino({
  formatters: {
    level: (label) => ({ level: label }),
    log: (obj) => ({
      ...obj,
      // Redactar secrets automáticamente
      ...redactSecrets(JSON.stringify(obj)),
    }),
  },
});

export function logRequest(req: Request) {
  const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID();
  const childLogger = logger.child({ correlationId });
  
  // Devolver headers para que el cliente vea el correlationId en errores
  return { correlationId, logger: childLogger };
}
```

```typescript
// middleware.ts (Next.js)
export function middleware(req: NextRequest) {
  const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID();
  const response = NextResponse.next();
  response.headers.set('x-correlation-id', correlationId);
  return response;
}
```

---

## 8. Acceptance criteria

- [ ] Todos los errores que devuelve la API tienen shape `AppError` con `code`, `message`, `correlationId`, `retryable`
- [ ] Mensajes en español, sin stack traces ni paths internos
- [ ] `correlationId` presente en respuesta + log del servidor (matcheable)
- [ ] Frontend usa `<ErrorState>` para TODOS los errores (no inline ad-hoc)
- [ ] Forms usan `fieldErrors` para validation errors
- [ ] Widgets en dashboard usan `WidgetErrorState` (in-place)
- [ ] Streaming SSE (NLQA) emite `error` event con shape consistente
- [ ] `toUserError` mapea correctamente todas las excepciones custom a `AppError`
- [ ] HTTP status derivado del `code` (1xxx→401, 2xxx→403, 3xxx→400, etc.)
- [ ] i18n estructurado en `messages/es.json` (preparado para Fase 2)
- [ ] Tests para cada `ErrorCode` (unit + integration)

---

## 9. Out of scope (MVP)

- ❌ Multi-idioma completo (Fase 2 con next-intl)
- ❌ Error analytics (Sentry / PostHog error tracking) — se loguea, no se analiza
- ❌ Auto-retry en frontend (depende del `retryable` flag, pero el handler está en backend)
- ❌ Errores visuales con ilustraciones custom por error

---

## 10. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Mensaje revela información sensible | Catálogo revisado: siempre mensajes genéricos cuando el detalle es sensible (ej: cross-tenant access) |
| correlationId no se propaga | Helper `logRequest` + middleware Next.js + logging child logger |
| Códigos inconsistentes entre features | Catálogo centralizado + lint rule que prohíbe strings custom en responses |
| Frontend no maneja todos los codes | `<ErrorState>` tiene fallback genérico para codes desconocidos |
| Logs filtran PII | `redactSecrets` + regex redaction de emails, IPs, etc. |

---

## 11. Roadmap (Fase 2+)

**Fase 2:**
- Multi-idioma completo (en.json + next-intl)
- Error analytics en Sentry (con PII scrubbing)
- Auto-retry exponencial en frontend para codes retryable
- Sugerencias contextuales ("¿querés abrir un ticket de soporte?")

**Fase 3:**
- AI-powered error explanation ("este error se debe a que tu tabla X no existe")
- Predictive error prevention (detectar queries que van a fallar antes de ejecutar)

---

## 12. Dependencias

```json
{
  "dependencies": {
    "pino": "^9.5.0",
    "zod": "^3.24.0"
  }
}
```

---

## 13. Specs relacionados

- `query-engine.md` — `QueryTimeoutError`, `ConnectorUnreachableError` se mapean a `query.timeout`, `connector.unreachable`
- `ai-generate-dashboards.md` — `llm.max_retries_exceeded` después de 3 retries
- `nlqa.md` — streaming SSE con `error` event
- `connectors.md` — `connector.ssrf_blocked`, `connector.file_too_large`
- `auth.md` — auth errors
- `multi-tenant.md` — `tenant.quota_exceeded`, `tenant.cross_tenant_access`
- `csv-excel-connector.md` — `connector.unsupported_format`, `connector.row_limit_exceeded`
- `export.md` — `export.timeout`, `export.render_failed`
- `widget-system.md` — `WidgetErrorState` con `data: null`
- `docs/security/threat-model.md` — T1-T8 controls + audit log
- `deployment.md` — logging estructurado en producción
