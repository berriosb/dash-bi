/**
 * Audit event types. Lista exhaustiva basada en `specs/multi-tenant.md §7.3`.
 *
 * Cada evento debe:
 * - Empezar con `<recurso>.<verbo_pasado>` (e.g., `dashboard.generated`)
 * - Ser snake_case lowercase
 * - Estar documentado en `docs/audits/<audit>/audit-events.md` (TODO Sprint 5)
 *
 * Para agregar un evento nuevo:
 * 1. Agregarlo a este union
 * 2. Llamar `audit()` con el nuevo evento
 * 3. Verificar que el test en `tests/unit/audit/log.test.ts` lo cubra
 */
export type AuditEvent =
  // ───── Auth ─────
  | 'auth.login'
  | 'auth.logout'
  | 'auth.signup'
  | 'auth.magic_link_sent'
  | 'auth.magic_link_used'
  | 'auth.failed_login'
  | 'auth.password_reset_requested'
  | 'auth.password_reset_completed'
  | 'auth.email_verification_sent'
  | 'auth.email_verified'
  // ───── Org ─────
  | 'org.created'
  | 'org.member_invited'
  | 'org.member_joined'
  | 'org.member_removed'
  | 'org.member_role_changed'
  | 'org.settings_updated'
  | 'org.switched'
  // ───── LLM config ─────
  | 'llm.config_updated'
  | 'llm.api_key_created'
  | 'llm.api_key_rotated'
  | 'llm.api_key_deleted'
  // ───── Data source ─────
  | 'datasource.created'
  | 'datasource.tested'
  | 'datasource.connection_failed'
  | 'datasource.schema_refreshed'
  | 'datasource.updated'
  | 'datasource.deleted'
  // ───── Dashboard ─────
  | 'dashboard.created'
  | 'dashboard.generated'
  | 'dashboard.updated'
  | 'dashboard.shared'
  | 'dashboard.unshared'
  | 'dashboard.deleted'
  | 'dashboard.duplicated'
  | 'dashboard.exported'
  // ───── Query ─────
  | 'query.executed'
  | 'query.failed'
  | 'query.cache_hit'
  // ───── Export ─────
  | 'export.pdf_requested'
  | 'export.pdf_completed'
  | 'export.pdf_failed'
  | 'export.png_requested'
  | 'export.png_completed'
  | 'export.link_generated'
  | 'export.link_revoked'
  // ───── Public link & Embed ─────
  | 'public_link.viewed'
  | 'embed.generated'
  | 'embed.viewed'
  // ───── NLQA (Sprint 4) ─────
  | 'nlqa.question_asked'
  | 'nlqa.answer_generated'
  // ───── Scheduled reports (Sprint 6) ─────
  | 'scheduled_report.created'
  | 'scheduled_report.updated'
  | 'scheduled_report.deleted'
  | 'scheduled_report.executed'
  | 'scheduled_report.failed'
  | 'scheduled_report.paused'
  | 'scheduled_report.resumed'
  // ───── Alerts (Sprint 7) ─────
  | 'alert.created'
  | 'alert.updated'
  | 'alert.deleted'
  | 'alert.paused'
  | 'alert.resumed'
  | 'alert.fired'
  | 'alert.delivered'
  | 'alert.delivery_failed'
  | 'alert.evaluation_failed'
  | 'alert.evaluation_suppressed';

/**
 * Categorías de eventos. Útil para agrupar en queries / dashboards admin.
 */
export const AUDIT_EVENT_CATEGORIES = {
  auth: ['auth.login', 'auth.logout', 'auth.signup', 'auth.magic_link_sent', 'auth.magic_link_used', 'auth.failed_login', 'auth.password_reset_requested', 'auth.password_reset_completed', 'auth.email_verification_sent', 'auth.email_verified'],
  org: ['org.created', 'org.member_invited', 'org.member_joined', 'org.member_removed', 'org.member_role_changed', 'org.settings_updated', 'org.switched'],
  llm: ['llm.config_updated', 'llm.api_key_created', 'llm.api_key_rotated', 'llm.api_key_deleted'],
  datasource: ['datasource.created', 'datasource.tested', 'datasource.connection_failed', 'datasource.schema_refreshed', 'datasource.updated', 'datasource.deleted'],
  dashboard: ['dashboard.created', 'dashboard.generated', 'dashboard.updated', 'dashboard.shared', 'dashboard.unshared', 'dashboard.deleted', 'dashboard.duplicated', 'dashboard.exported'],
  query: ['query.executed', 'query.failed', 'query.cache_hit'],
  export: ['export.pdf_requested', 'export.pdf_completed', 'export.pdf_failed', 'export.png_requested', 'export.png_completed', 'export.link_generated', 'export.link_revoked'],
  public_link: ['public_link.viewed'],
  nlqa: ['nlqa.question_asked', 'nlqa.answer_generated'],
  scheduled_report: ['scheduled_report.created', 'scheduled_report.updated', 'scheduled_report.deleted', 'scheduled_report.executed', 'scheduled_report.failed', 'scheduled_report.paused', 'scheduled_report.resumed'],
  alert: ['alert.created', 'alert.updated', 'alert.deleted', 'alert.paused', 'alert.resumed', 'alert.fired', 'alert.delivered', 'alert.delivery_failed', 'alert.evaluation_failed', 'alert.evaluation_suppressed'],
} as const satisfies Record<string, readonly AuditEvent[]>;

export type AuditCategory = keyof typeof AUDIT_EVENT_CATEGORIES;

/**
 * Metadata sensible que NUNCA debe aparecer en audit log:
 * - API keys / passwords / tokens
 * - Full credit card numbers
 * - SSN completo
 *
 * El logger tiene redaction automática (ver `lib/redact.ts`) pero
 * por defense in depth, el caller debe evitar pasar estos campos.
 */
export const AUDIT_FORBIDDEN_METADATA_KEYS = [
  'password',
  'apiKey',
  'api_key',
  'token',
  'secret',
  'ssn',
  'creditCard',
  'credit_card',
  'cardNumber',
  'card_number',
  'cvv',
] as const;

/**
 * Assert en tiempo de dev que el metadata no incluye keys prohibidas.
 * En producción, el log igual redacta (defense in depth).
 */
export function assertSafeMetadata(metadata: Record<string, unknown> | undefined): void {
  if (!metadata) return;
  if (process.env.NODE_ENV === 'production') return; // Skip en prod (ya hay redaction)

  for (const key of Object.keys(metadata)) {
    if ((AUDIT_FORBIDDEN_METADATA_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `Audit metadata uses forbidden key "${key}". This is likely a security bug — remove sensitive data before logging.`,
      );
    }
  }
}