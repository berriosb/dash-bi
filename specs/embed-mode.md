# Spec: Embed Mode (Dashboards Embebidos)

> Sistema de dashboards embebidos para aplicaciones SaaS de terceros vía `<iframe>` con tokens firmados, control de dominios permitidos (CSP `frame-ancestors`), override de temas visuales y comunicación bidireccional mediante `postMessage`. **Feature Tier 2 competitivo P1**.

**Status:** Ready for Implementation v1.0  
**Prioridad:** P1 — Habilita el caso de uso B2B Embedded Analytics (monetización SaaS)  
**Responsable:** codehak  
**Depende de:** `export.md` (patrón de tokens públicos), `multi-tenant.md` (aislamiento y contexto), `widget-system.md` (superficie de widgets), `layouts-themes.md` (temas y CSS variables)

---

## 1. Objetivo

Permitir que las organizaciones en dash-bi puedan:

1. **Embeber dashboards en sus propias aplicaciones web** (B2B SaaS / Portales de clientes) mediante un `<iframe>`.
2. **Generar tokens firmados (`embed_tokens`)** con expiración configurable (ej. 1 hora, 30 días o sin expiración) y clave secreta HMAC.
3. **Restringir dominios de origen (Allowed Origins / CSP)**: Proteger contra framing no autorizado mediante la directiva `Content-Security-Policy: frame-ancestors <allowed_domains>`.
4. **Personalizar la experiencia embebida**:
   - Ocultar cabecera de plataforma y navegación (vista limpia "Zero-Chrome").
   - Forzar o heredar temas visuales (`moderno-saas`, `corporate`, `transparent`).
   - Habilitar o deshabilitar interactividad (read-only, zoom de gráficos, filtros).
5. **Comunicación reactiva (`postMessage` Protocol)**:
   - Notificación de altura dinámica para auto-resize del iframe sin scrollbars (`dashbi:resize`).
   - Envío de eventos al host parent (`dashbi:widget-click`, `dashbi:loaded`).

---

## 2. Arquitectura de Seguridad y Flujo

```
┌────────────────────────────────────────────────────────┐
│  Host Application (SaaS Cliente: app.cliente.com)       │
│                                                        │
│   ┌────────────────────────────────────────────────┐   │
│   │ <iframe src="https://dash-bi.com/embed/TOKEN"> │   │
│   │                                                │   │
│   │   [Header Oculto]                              │   │
│   │   [Grid de 12 columnas con Widgets]            │   │
│   │   [postMessage altura -> parent]               │   │
│   └────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

### 2.1 Principios de Seguridad
1. **Firma Criptográfica**: El token de embebido contiene `dashboardId`, `orgId`, `allowedOrigins`, `expiresAt`, `theme` y `signature` generada con HMAC-SHA256 usando `LLM_KEY_ENCRYPTION_KEY` o `BETTER_AUTH_SECRET`.
2. **Protección Clickjacking**: Si el embed token especifica `allowedOrigins: ["https://app.cliente.com"]`, el servidor responde con la cabecera HTTP:
   `Content-Security-Policy: frame-ancestors https://app.cliente.com;`
   Si no se configuran dominios, por defecto solo se permite en modo preview local o dominios autorizados explícitamente.
3. **Aislamiento Multi-tenant**: La consulta de los datos del dashboard embebido se ejecuta estrictamente en contexto RLS vía `withOrgContext()`.

---

## 3. Modelo de Datos y Tipos

### 3.1 Estructura del Embed Token Payload

```typescript
export interface EmbedTokenPayload {
  token: string;
  dashboardId: string;
  orgId: string;
  allowedOrigins: string[]; // ej: ["https://app.ejemplo.com"] o ["*"]
  theme?: 'moderno-saas' | 'corporate' | 'transparent';
  hideTitle?: boolean;
  allowExport?: boolean;
  expiresAt?: string | null; // ISO string o null (sin expiración)
  createdAt: string;
}

export interface EmbedVerifyResult {
  valid: boolean;
  payload?: EmbedTokenPayload;
  error?: 'expired' | 'invalid_signature' | 'invalid_origin' | 'not_found';
}
```

### 3.2 Tabla `embed_tokens` (Base de Datos)

```typescript
export const embedTokens = pgTable('embed_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  dashboardId: uuid('dashboard_id').notNull().references(() => dashboards.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  allowedOrigins: jsonb('allowed_origins').$type<string[]>().notNull().default(['*']),
  theme: text('theme').$type<'moderno-saas' | 'corporate' | 'transparent'>().default('moderno-saas'),
  hideTitle: boolean('hide_title').default(false),
  allowExport: boolean('allow_export').default(false),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tokenIdx: index('embed_tokens_token_idx').on(t.token),
  dashboardIdx: index('embed_tokens_dashboard_idx').on(t.dashboardId),
}));
```

---

## 4. Endpoints API

### 4.1 Crear Embed Token
`POST /api/dashboards/[id]/embed`
- **Auth**: Requiere sesión activa con permiso `dashboards:edit` (Owner / Admin / Member).
- **Body**:
  ```json
  {
    "allowedOrigins": ["https://app.cliente.com"],
    "theme": "moderno-saas",
    "hideTitle": false,
    "allowExport": false,
    "expiresInDays": 30
  }
  ```
- **Response (201)**:
  ```json
  {
    "token": "emb_7f8a9c2b...",
    "embedUrl": "https://dash-bi.com/embed/emb_7f8a9c2b...",
    "iframeSnippet": "<iframe src=\"https://dash-bi.com/embed/emb_7f8a9c2b...\" width=\"100%\" height=\"600\" frameborder=\"0\"></iframe>"
  }
  ```

### 4.2 Obtener Datos del Dashboard Embebido
`GET /api/embed/[token]`
- **Auth**: Público (validado vía token de embebido).
- **Verificación**: Valida firma HMAC, expiración y origen HTTP `Referer` / `Origin`.
- **Response (200)**: Retorna el schema del dashboard y widgets para renderizado sin shell administrativo.

### 4.3 Revocar Embed Token
`DELETE /api/embed-tokens/[id]`
- **Auth**: Requiere permiso `dashboards:edit`.
- **Response (200)**: `{ "ok": true }`

---

## 5. Protocolo `postMessage` (SDK del Iframe)

Para integración fluida sin scrollbars innecesarias, la vista `/embed/[token]` emite mensajes a la ventana padre `window.parent`:

```typescript
// 1. Notificación de altura al cargar y redimensionar
window.parent.postMessage({
  type: 'dashbi:resize',
  payload: { height: document.documentElement.scrollHeight }
}, '*');

// 2. Notificación de carga lista
window.parent.postMessage({
  type: 'dashbi:loaded',
  payload: { dashboardId, title }
}, '*');
```

---

## 6. UI: Diálogo de Embebido ("Embed Dashboard")

Ubicado en la barra superior del Dashboard Studio (`ExportShareDialog.tsx` o tab `Embeber`):
1. **Configuración de Dominios**: Input para agregar dominios autorizados (`https://mi-empresa.com`).
2. **Opciones Visuales**: Selector de tema (Moderno, Corporate, Transparente) y checkbox "Ocultar título".
3. **Generador de Snippet**: Código `<iframe>` listo para copiar en 1 clic con botón de copiado rápido y toast de confirmación.
4. **Listado de Tokens Activos**: Vista de tokens creados con opción de revocación inmediata.

---

## 7. Criterios de Aceptación y Pruebas

- [ ] Generación de tokens HMAC determinísticos y criptográficamente seguros.
- [ ] Validación estricta de expiración (tokens vencidos devuelven 401/403).
- [ ] Cabeceras CSP `frame-ancestors` configuradas acorde a `allowedOrigins`.
- [ ] `/embed/[token]` renderiza el dashboard completo sin la barra de navegación ni el sidebar administrativo.
- [ ] Eventos `postMessage` emitidos correctamente con la altura calculada del documento.
- [ ] Cobertura con tests unitarios y de integración RLS.
