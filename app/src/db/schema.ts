import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  integer,
  jsonb,
  unique,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────

export const connectorTypeEnum = pgEnum('connector_type', [
  'postgres',
  'stripe',
  'sheets',
  'csv',
  'excel',
  'mysql',
  'shopify',
]);

export const themeEnum = pgEnum('theme', ['moderno-saas', 'corporate']);

export const planEnum = pgEnum('plan', ['free', 'pro', 'enterprise']);

export const roleEnum = pgEnum('org_role', ['admin', 'editor', 'viewer']);

export const llmProviderEnum = pgEnum('llm_provider', [
  'openai',
  'anthropic',
  'gemini',
]);

export const archetypeEnum = pgEnum('archetype', [
  'kpi-grid',
  'hero-focus',
  'cohort-matrix',
  'sales-pipeline',
  'executive-summary',
  'operations-live',
  'finance-report',
  'growth-metrics',
  'custom',
]);

export const densityEnum = pgEnum('density', ['spacious', 'balanced', 'dense']);

export const themeAccentEnum = pgEnum('theme_accent', ['default', 'accent', 'muted']);

export const timeWindowEnum = pgEnum('time_window', [
  'last_24h',
  'last_7d',
  'last_30d',
  'last_quarter',
  'last_90d',
  'last_6mo',
  'last_year',
  'all_time',
]);

export const comparativoEnum = pgEnum('comparativo', [
  'none',
  'previous_period',
  'previous_month',
  'previous_quarter',
  'previous_year',
  'last_year_same_week',
]);

// ─────────────────────────────────────────────────────────────────
// Organizations (tenants)
// ─────────────────────────────────────────────────────────────────

export const orgs = pgTable(
  'orgs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),

    // LLM config (BYOK cifrado)
    llmProvider: llmProviderEnum('llm_provider').notNull().default('openai'),
    llmModel: text('llm_model').notNull().default('gpt-4o'),
    llmApiKeyEncrypted: text('llm_api_key_encrypted'),
    llmFallbackProvider: llmProviderEnum('llm_fallback_provider'),
    llmFallbackModel: text('llm_fallback_model'),

    // Theme & branding
    defaultTheme: themeEnum('default_theme').notNull().default('moderno-saas'),
    brandLogoUrl: text('brand_logo_url'),
    brandPrimaryColor: text('brand_primary_color'),

    // Plan & quotas
    plan: planEnum('plan').notNull().default('free'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: unique('orgs_slug_idx').on(t.slug),
  }),
);

// ─────────────────────────────────────────────────────────────────
// Users (globales, pueden pertenecer a múltiples orgs)
// ─────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name'),
    avatarUrl: text('avatar_url'),

    emailVerified: boolean('email_verified').notNull().default(false),

    activeOrgId: uuid('active_org_id'),

    // Onboarding state (per onboarding.md §6)
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    currentOnboardingStep: text('current_onboarding_step'),
    onboardingDataSourceId: uuid('onboarding_data_source_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => ({
    emailIdx: unique('users_email_idx').on(t.email),
  }),
);

// ─────────────────────────────────────────────────────────────────
// Sessions (better-auth)
// ─────────────────────────────────────────────────────────────────

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────
// Accounts (better-auth OAuth + credential linking)
// ─────────────────────────────────────────────────────────────────

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerAccountIdx: index('accounts_provider_account_idx').on(t.providerId, t.accountId),
    userIdx: index('accounts_user_idx').on(t.userId),
  }),
);

// ─────────────────────────────────────────────────────────────────
// Verifications (better-auth magic link + email verification tokens)
// ─────────────────────────────────────────────────────────────────

export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    identifierIdx: index('verifications_identifier_idx').on(t.identifier),
  }),
);

// ─────────────────────────────────────────────────────────────────
// Org Members (many-to-many)
// ─────────────────────────────────────────────────────────────────

export const orgMembers = pgTable(
  'org_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),

    invitedBy: uuid('invited_by').references(() => users.id),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    joinedAt: timestamp('joined_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueMember: unique('org_members_unique').on(t.orgId, t.userId),
    orgIdx: index('org_members_org_idx').on(t.orgId),
    userIdx: index('org_members_user_idx').on(t.userId),
  }),
);

// ─────────────────────────────────────────────────────────────────
// Data Sources (tenant-scoped)
// ─────────────────────────────────────────────────────────────────

export const dataSources = pgTable(
  'data_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),

    type: connectorTypeEnum('type').notNull(),
    name: text('name').notNull(),

    configEncrypted: text('config_encrypted').notNull(),

    schemaCache: jsonb('schema_cache'),
    schemaCachedAt: timestamp('schema_cached_at', { withTimezone: true }),

    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestOk: boolean('last_test_ok'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('data_sources_org_idx').on(t.orgId),
  }),
);

// ─────────────────────────────────────────────────────────────────
// Dashboards (tenant-scoped)
// ─────────────────────────────────────────────────────────────────

export const dashboards = pgTable(
  'dashboards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),

    title: text('title').notNull(),
    description: text('description'),
    theme: themeEnum('theme').notNull().default('moderno-saas'),

    // Widgets (JSON validado por Zod antes de guardar)
    widgets: jsonb('widgets').notNull().default([]),

    // Archetype metadata persisted as columns so we can index / filter
    // on it without parsing the JSONB widgets array.
    archetype: archetypeEnum('archetype').notNull().default('custom'),
    archetypeVariantDensity: densityEnum('archetype_variant_density').notNull().default('balanced'),
    archetypeVariantAccent: themeAccentEnum('archetype_variant_accent').notNull().default('default'),
    archetypeVariantTimeWindow: timeWindowEnum('archetype_variant_time_window').notNull().default('last_30d'),
    archetypeVariantComparativo: comparativoEnum('archetype_variant_comparativo').notNull().default('previous_period'),

    // Schema version (para migraciones futuras del formato)
    schemaVersion: integer('schema_version').notNull().default(1),

    createdBy: uuid('created_by').notNull().references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('dashboards_org_idx').on(t.orgId),
  }),
);

// ─────────────────────────────────────────────────────────────────
// Dashboard Versions (history for rollback)
// ─────────────────────────────────────────────────────────────────

export const dashboardVersions = pgTable(
  'dashboard_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dashboardId: uuid('dashboard_id').notNull().references(() => dashboards.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),

    version: integer('version').notNull(),
    widgets: jsonb('widgets').notNull(),
    theme: themeEnum('theme').notNull(),

    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    prompt: text('prompt'),
    generatedBy: text('generated_by'),
  },
  (t) => ({
    dashboardVersionUnique: unique('dashboard_versions_unique').on(t.dashboardId, t.version),
    orgIdx: index('dashboard_versions_org_idx').on(t.orgId),
  }),
);

// ─────────────────────────────────────────────────────────────────
// Public Links (compartir dashboards sin auth)
// ─────────────────────────────────────────────────────────────────

export const publicLinks = pgTable(
  'public_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    dashboardId: uuid('dashboard_id').notNull().references(() => dashboards.id, { onDelete: 'cascade' }),

    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    viewCount: integer('view_count').notNull().default(0),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),

    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenIdx: unique('public_links_token_idx').on(t.token),
    orgIdx: index('public_links_org_idx').on(t.orgId),
  }),
);

// ─────────────────────────────────────────────────────────────────
// LLM Usage (cost tracking)
// ─────────────────────────────────────────────────────────────────

export const llmUsage = pgTable(
  'llm_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id),

    provider: llmProviderEnum('provider').notNull(),
    model: text('model').notNull(),

    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    costUsd: text('cost_usd').notNull(), // numeric, stored as text to avoid precision issues

    latencyMs: integer('latency_ms'),
    success: boolean('success').notNull(),
    error: text('error'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('llm_usage_org_idx').on(t.orgId),
    createdAtIdx: index('llm_usage_created_at_idx').on(t.createdAt),
  }),
);

// ─────────────────────────────────────────────────────────────────
// Audit Log
// ─────────────────────────────────────────────────────────────────

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id'),

    action: text('action').notNull(),
    resource: text('resource'),
    metadata: jsonb('metadata'),

    ip: text('ip'),
    userAgent: text('user_agent'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('audit_log_org_idx').on(t.orgId),
    createdAtIdx: index('audit_log_created_at_idx').on(t.createdAt),
  }),
);

// ─────────────────────────────────────────────────────────────────
// Uploaded files (Sprint 1.5 tier-1: CSV/Excel connector)
//
// Cada archivo subido se materializa en una tabla Postgres dedicada
// (ver lib/connectors/parsers/load.ts). Esta tabla `uploaded_files`
// sólo guarda metadata + el nombre de la tabla materializada.
// ─────────────────────────────────────────────────────────────────

export const uploadedFileFormatEnum = pgEnum('uploaded_file_format', [
  'csv',
  'xlsx',
  'xls',
]);

export const uploadedFileColumnTypeEnum = pgEnum('uploaded_file_column_type', [
  'number',
  'string',
  'date',
  'boolean',
  'json',
]);

export type UploadedFileColumn = {
  name: string;
  type: 'number' | 'string' | 'date' | 'boolean' | 'json';
  nullable: boolean;
  samples: unknown[];
};

export const uploadedFiles = pgTable(
  'uploaded_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    originalFilename: text('original_filename').notNull(),
    format: uploadedFileFormatEnum('format').notNull(),
    sizeBytes: integer('size_bytes').notNull(),

    // Tabla Postgres donde se cargaron los datos. El connector
    // 'spreadsheet' corre SQL sobre esta tabla. Ver specs/csv-excel-connector.md §4.2.
    targetTable: text('target_table').notNull(),
    rowCount: integer('row_count').notNull(),

    columns: jsonb('columns').$type<UploadedFileColumn[]>().notNull(),

    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    orgIdx: index('uploaded_files_org_idx').on(t.orgId),
  }),
);

// ─────────────────────────────────────────────────────────────────
// NLQA — conversaciones y mensajes (Sprint 3)
// ─────────────────────────────────────────────────────────────────
//
// Una conversación agrupa N mensajes user/assistant sobre el mismo
// data source. Permite "memory" dentro de la sesión: "ahora filtrá
// por Q3" funciona si los turnos anteriores ya filtraron Q3.
//
// Para MVP: 1 conversación = 1 data source + 1 usuario. No se
// comparte entre usuarios. En Fase 2 podemos extender.

export const nlqaConversations = pgTable(
  'nlqa_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    dataSourceId: uuid('data_source_id').notNull().references(() => dataSources.id, { onDelete: 'cascade' }),

    title: text('title').notNull().default('Nueva conversación'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('nlqa_conversations_org_idx').on(t.orgId),
    userIdx: index('nlqa_conversations_user_idx').on(t.userId),
    dataSourceIdx: index('nlqa_conversations_data_source_idx').on(t.dataSourceId),
  }),
);

export const nlqaRoleEnum = pgEnum('nlqa_role', ['user', 'assistant', 'system']);

export const nlqaMessages = pgTable(
  'nlqa_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull().references(() => nlqaConversations.id, { onDelete: 'cascade' }),

    role: nlqaRoleEnum('role').notNull(),

    // user: question text
    // assistant: answer text + optional sql + chart suggestion
    // system: opcional, reservado para futuras prompts internas
    content: text('content').notNull(),

    // Solo assistant. SQL que la IA generó + ejecutó (para mostrar al user).
    generatedSql: text('generated_sql'),
    generatedChartType: text('generated_chart_type'),
    generatedChartConfig: jsonb('generated_chart_config'),
    rowCount: integer('row_count'),
    executionMs: integer('execution_ms'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    conversationIdx: index('nlqa_messages_conversation_idx').on(t.conversationId),
    createdAtIdx: index('nlqa_messages_created_at_idx').on(t.createdAt),
  }),
);

// ─────────────────────────────────────────────────────────────────
// Scheduled Reports (tenant-scoped)
// ─────────────────────────────────────────────────────────────────

export const scheduledReports = pgTable(
  'scheduled_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    dashboardId: uuid('dashboard_id').notNull().references(() => dashboards.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').notNull().references(() => users.id),

    cron: text('cron').notNull(),
    timezone: text('timezone').notNull().default('America/Santiago'),

    format: text('format').$type<'pdf' | 'png-link'>().notNull().default('pdf'),
    includeBranding: boolean('include_branding').notNull().default(true),

    recipients: jsonb('recipients').$type<Array<{ email: string; name?: string }>>().notNull(),

    enabled: boolean('enabled').notNull().default(true),

    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastRunStatus: text('last_run_status').$type<'success' | 'failed' | 'skipped'>(),
    lastRunErrorCode: text('last_run_error_code'),
    lastRunCorrelationId: text('last_run_correlation_id'),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),

    title: text('title'),
    description: text('description'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('scheduled_reports_org_idx').on(t.orgId),
    nextRunIdx: index('scheduled_reports_next_run_idx').on(t.nextRunAt),
  }),
);

export const scheduledReportRuns = pgTable(
  'scheduled_report_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    scheduledReportId: uuid('scheduled_report_id').notNull().references(() => scheduledReports.id, { onDelete: 'cascade' }),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    status: text('status').$type<'running' | 'success' | 'failed' | 'skipped'>().notNull(),

    fileUrl: text('file_url'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    correlationId: text('correlation_id'),
  },
  (t) => ({
    scheduledReportIdx: index('scheduled_report_runs_report_idx').on(t.scheduledReportId),
  }),
);