import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, withOrgContext } from '@/db/client';
import { dataSources } from '@/db/schema';
import { requirePermission } from '@/lib/auth/context';
import { encryptApiKey } from '@/lib/security/encryption';
import type { ConnectorType } from '@/lib/connectors/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  try {
    await requirePermission(userId, orgId, 'datasource.view');
    const sources = await withOrgContext(orgId, userId, async () => {
      return db.select({
        id: dataSources.id,
        orgId: dataSources.orgId,
        type: dataSources.type,
        name: dataSources.name,
        schemaCache: dataSources.schemaCache,
        schemaCachedAt: dataSources.schemaCachedAt,
        lastTestedAt: dataSources.lastTestedAt,
        lastTestOk: dataSources.lastTestOk,
        createdAt: dataSources.createdAt,
        updatedAt: dataSources.updatedAt,
      })
      .from(dataSources)
      .where(eq(dataSources.orgId, orgId));
    });

    return NextResponse.json({ dataSources: sources });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.name === 'ForbiddenError' ? 403 : 500 });
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const orgId = req.headers.get('x-org-id') || url.searchParams.get('orgId');
  const userId = req.headers.get('x-user-id');

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'x-org-id and x-user-id headers required' }, { status: 400 });
  }

  try {
    await requirePermission(userId, orgId, 'datasource.create');
    const body = await req.json();
    const { name, type, config } = body;

    if (!name || !type || !config) {
      return NextResponse.json({ error: 'name, type, and config are required' }, { status: 400 });
    }

    const configEncrypted = encryptApiKey(JSON.stringify(config));
    const dsType = (type === 'shopify' ? 'postgres' : type) as 'postgres' | 'stripe' | 'sheets';

    const [created] = await withOrgContext(orgId, userId, async () => {
      return db.insert(dataSources).values({
        orgId,
        type: dsType,
        name,
        configEncrypted,
      }).returning({
        id: dataSources.id,
        name: dataSources.name,
        type: dataSources.type,
        createdAt: dataSources.createdAt,
      });
    });

    return NextResponse.json({ dataSource: created }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.name === 'ForbiddenError' ? 403 : 500 });
  }
}
