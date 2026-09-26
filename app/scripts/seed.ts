#!/usr/bin/env tsx
/**
 * Database Seeder for dash-bi.
 *
 * Populates a local or staging PostgreSQL database with:
 * - A demo tenant organization (`demo-org`)
 * - An admin user (`demo@dash-bi.com`)
 * - An organization membership with 'admin' role
 * - A verified PostgreSQL data source
 * - A pre-built executive SaaS dashboard with widgets
 *
 * Usage:
 *   pnpm db:seed
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import {
  orgs,
  users,
  orgMembers,
  dataSources,
  dashboards,
  dashboardVersions,
} from '@/db/schema';
import { encryptApiKey } from '@/lib/security/encryption';

const DEFAULT_MASTER_KEY =
  process.env.LLM_KEY_ENCRYPTION_KEY ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export const DEMO_IDS = {
  orgId: '00000000-0000-4000-a000-000000000001',
  userId: '00000000-0000-4000-a000-000000000002',
  dataSourceId: '00000000-0000-4000-a000-000000000003',
  dashboardId: '00000000-0000-4000-a000-000000000004',
};

const DEMO_WIDGETS = [
  {
    id: 'kpi-mrr',
    type: 'kpi',
    position: { col: 1, row: 1, colSpan: 3, rowSpan: 1 },
    config: { title: 'Ingresos Mensuales (MRR)', format: 'currency', showDelta: true },
    data: { value: 128400, delta: 12.4 },
    source: {
      kind: 'query',
      dataSourceId: DEMO_IDS.dataSourceId,
      query: { kind: 'sql', sql: 'SELECT 128400 AS value, 12.4 AS delta' },
      refresh: { mode: 'cached-ttl', ttlSeconds: 60 },
    },
  },
  {
    id: 'kpi-arr',
    type: 'kpi',
    position: { col: 4, row: 1, colSpan: 3, rowSpan: 1 },
    config: { title: 'ARR Proyectado', format: 'currency', showDelta: true },
    data: { value: 1540800, delta: 15.2 },
    source: {
      kind: 'query',
      dataSourceId: DEMO_IDS.dataSourceId,
      query: { kind: 'sql', sql: 'SELECT 1540800 AS value, 15.2 AS delta' },
      refresh: { mode: 'cached-ttl', ttlSeconds: 60 },
    },
  },
  {
    id: 'kpi-churn',
    type: 'kpi',
    position: { col: 7, row: 1, colSpan: 3, rowSpan: 1 },
    config: { title: 'Tasa de Churn', format: 'percent', showDelta: true },
    data: { value: 1.8, delta: -0.4 },
    source: {
      kind: 'query',
      dataSourceId: DEMO_IDS.dataSourceId,
      query: { kind: 'sql', sql: 'SELECT 1.8 AS value, -0.4 AS delta' },
      refresh: { mode: 'cached-ttl', ttlSeconds: 60 },
    },
  },
  {
    id: 'kpi-customers',
    type: 'kpi',
    position: { col: 10, row: 1, colSpan: 3, rowSpan: 1 },
    config: { title: 'Clientes Activos', format: 'number', showDelta: true },
    data: { value: 2450, delta: 8.1 },
    source: {
      kind: 'query',
      dataSourceId: DEMO_IDS.dataSourceId,
      query: { kind: 'sql', sql: 'SELECT 2450 AS value, 8.1 AS delta' },
      refresh: { mode: 'cached-ttl', ttlSeconds: 60 },
    },
  },
  {
    id: 'chart-mrr-trend',
    type: 'area-chart',
    position: { col: 1, row: 2, colSpan: 8, rowSpan: 3 },
    config: {
      title: 'Evolución de Ingresos y MRR (USD)',
      smooth: true,
      showLegend: true,
      showGrid: true,
    },
    data: {
      series: [
        {
          name: 'MRR Facturado',
          data: [
            { x: 'Ene', y: 84000 },
            { x: 'Feb', y: 92500 },
            { x: 'Mar', y: 101200 },
            { x: 'Abr', y: 112000 },
            { x: 'May', y: 119800 },
            { x: 'Jun', y: 128400 },
          ],
        },
      ],
    },
    source: {
      kind: 'query',
      dataSourceId: DEMO_IDS.dataSourceId,
      query: { kind: 'sql', sql: 'SELECT month, mrr FROM monthly_revenue' },
      refresh: { mode: 'cached-ttl', ttlSeconds: 300 },
    },
  },
];

export async function seedDatabase(connectionString: string) {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  try {
    console.log('🌱 Iniciando seed de la base de datos...');

    // 1. Organization
    console.log('  → Creando organización demo...');
    await db
      .insert(orgs)
      .values({
        id: DEMO_IDS.orgId,
        name: 'Empresa Demo SaaS',
        slug: 'demo-org',
        defaultTheme: 'moderno-saas',
        plan: 'pro',
      })
      .onConflictDoUpdate({
        target: orgs.id,
        set: { name: 'Empresa Demo SaaS', updatedAt: new Date() },
      });

    // 2. User
    console.log('  → Creando usuario admin demo...');
    await db
      .insert(users)
      .values({
        id: DEMO_IDS.userId,
        email: 'demo@dash-bi.com',
        name: 'Admin Demo',
        emailVerified: true,
        activeOrgId: DEMO_IDS.orgId,
        onboardingCompletedAt: new Date(),
        currentOnboardingStep: 'completed',
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { name: 'Admin Demo', activeOrgId: DEMO_IDS.orgId, updatedAt: new Date() },
      });

    // 3. Org Membership
    console.log('  → Asignando membresía de organización...');
    const [existingMember] = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.orgId, DEMO_IDS.orgId));

    if (!existingMember) {
      await db.insert(orgMembers).values({
        orgId: DEMO_IDS.orgId,
        userId: DEMO_IDS.userId,
        role: 'admin',
        joinedAt: new Date(),
      });
    }

    // 4. Data Source
    console.log('  → Creando fuente de datos de ejemplo...');
    const configPayload = JSON.stringify({
      host: 'localhost',
      port: 5432,
      database: 'dashbi',
      username: 'dashbi_readonly',
      password: 'readonly_password',
    });
    const encryptedConfig = encryptApiKey(configPayload, DEFAULT_MASTER_KEY);

    await db
      .insert(dataSources)
      .values({
        id: DEMO_IDS.dataSourceId,
        orgId: DEMO_IDS.orgId,
        type: 'postgres',
        name: 'PostgreSQL Producción',
        configEncrypted: encryptedConfig,
        lastTestedAt: new Date(),
        lastTestOk: true,
      })
      .onConflictDoUpdate({
        target: dataSources.id,
        set: { lastTestOk: true, updatedAt: new Date() },
      });

    // 5. Dashboard
    console.log('  → Creando dashboard principal...');
    await db
      .insert(dashboards)
      .values({
        id: DEMO_IDS.dashboardId,
        orgId: DEMO_IDS.orgId,
        title: 'Mesa de Decisión Ejecutiva — SaaS Analytics',
        description: 'Métricas clave de facturación, retención y crecimiento recurrente.',
        theme: 'moderno-saas',
        archetype: 'kpi-grid',
        widgets: DEMO_WIDGETS,
        createdBy: DEMO_IDS.userId,
      })
      .onConflictDoUpdate({
        target: dashboards.id,
        set: {
          title: 'Mesa de Decisión Ejecutiva — SaaS Analytics',
          widgets: DEMO_WIDGETS,
          updatedAt: new Date(),
        },
      });

    // 6. Dashboard Version
    await db
      .insert(dashboardVersions)
      .values({
        orgId: DEMO_IDS.orgId,
        dashboardId: DEMO_IDS.dashboardId,
        version: 1,
        theme: 'moderno-saas',
        widgets: DEMO_WIDGETS,
        prompt: 'Seed inicial',
        createdBy: DEMO_IDS.userId,
      })
      .onConflictDoNothing();

    console.log('✅ Seed completado con éxito.');
    console.log(`   Org ID:       ${DEMO_IDS.orgId} (slug: demo-org)`);
    console.log(`   User Email:   demo@dash-bi.com`);
    console.log(`   Dashboard ID: ${DEMO_IDS.dashboardId}`);
  } finally {
    await client.end();
  }
}

// Direct CLI execution
const isEntryPoint = import.meta.url === `file://${process.argv[1]}`;

if (isEntryPoint) {
  const connectionString =
    process.env.DATABASE_URL || 'postgres://dashbi:dashbi_password@localhost:5432/dashbi';

  seedDatabase(connectionString)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Error durante el seed:', err);
      process.exit(1);
    });
}
