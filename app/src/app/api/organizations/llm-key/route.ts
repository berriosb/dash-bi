import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { withOrgContext } from '@/db/client';
import { orgs } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { encryptApiKey } from '@/lib/security/encryption';
import { errorResponse } from '@/lib/errors/response';
import { AppErrorException } from '@/lib/errors/types';
import { audit } from '@/lib/audit/log';

export const dynamic = 'force-dynamic';

/**
 * T4 — BYOK: store the organization's own LLM credentials.
 *
 * The settings page used to claim the key was saved while no write path
 * existed anywhere in the app, so the user's key was discarded on navigation
 * and every LLM call silently billed the platform credential instead.
 *
 * Contract, in order of how easy it is to get wrong:
 *   - The key is encrypted at rest with `encryptApiKey` (AES-256-GCM) and is
 *     never returned by any verb. `GET` reports only `hasApiKey`.
 *   - The key is never written to the audit metadata, only the fact that one
 *     was set or cleared.
 *   - Reads and writes are scoped to `ctx.orgId`, which `requireAuth`
 *     derives from the session — never from the request body.
 */

const putSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'gemini']),
  model: z.string().min(1).max(120),
  apiKey: z.string().min(1, 'La API key no puede estar vacía').max(500),
});

type OrgLlmRow = {
  llmProvider: string;
  llmModel: string;
  llmApiKeyEncrypted: string | null;
};

async function readOrgConfig(
  orgId: string,
  userId: string,
  role: 'admin' | 'editor' | 'viewer',
): Promise<OrgLlmRow | null> {
  return withOrgContext(orgId, userId, role, async (tx) => {
    const rows = await tx
      .select({
        llmProvider: orgs.llmProvider,
        llmModel: orgs.llmModel,
        llmApiKeyEncrypted: orgs.llmApiKeyEncrypted,
      })
      .from(orgs)
      .where(eq(orgs.id, orgId))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function GET(req: Request) {
  try {
    const ctx = await requireAuth(req, 'dashboard.view');
    const row = await readOrgConfig(ctx.orgId, ctx.userId, ctx.role);

    return NextResponse.json({
      provider: row?.llmProvider ?? 'openai',
      model: row?.llmModel ?? 'gpt-4o',
      // Never the key itself — only whether one is configured.
      hasApiKey: Boolean(row?.llmApiKeyEncrypted),
    });
  } catch (error) {
    return errorResponse(error, req);
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireAuth(req, 'org.updateLLMConfig');

    const parsed = putSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      // AppErrorException carries the code through `toUserError`; a bare
      // `{ __code }` property does not, and would surface as a 500.
      return errorResponse(
        new AppErrorException('validation.invalid_format', 'Configuración de IA inválida'),
        req,
      );
    }

    const { provider, model, apiKey } = parsed.data;
    const encrypted = encryptApiKey(apiKey);

    await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) => {
      await tx
        .update(orgs)
        .set({
          llmProvider: provider,
          llmModel: model,
          llmApiKeyEncrypted: encrypted,
          updatedAt: new Date(),
        })
        .where(eq(orgs.id, ctx.orgId));
    });

    await audit(ctx.orgId, ctx.userId, 'org.settings_updated', `org:${ctx.orgId}`, {
      // Deliberately no key material: only the shape of the change.
      metadata: { apiKeySet: true, provider, model },
      req,
    });

    return NextResponse.json({ ok: true, hasApiKey: true });
  } catch (error) {
    return errorResponse(error, req);
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await requireAuth(req, 'org.updateLLMConfig');

    await withOrgContext(ctx.orgId, ctx.userId, ctx.role, async (tx) => {
      await tx
        .update(orgs)
        .set({ llmApiKeyEncrypted: null, updatedAt: new Date() })
        .where(eq(orgs.id, ctx.orgId));
    });

    await audit(ctx.orgId, ctx.userId, 'org.settings_updated', `org:${ctx.orgId}`, {
      metadata: { apiKeyCleared: true },
      req,
    });

    return NextResponse.json({ ok: true, hasApiKey: false });
  } catch (error) {
    return errorResponse(error, req);
  }
}
