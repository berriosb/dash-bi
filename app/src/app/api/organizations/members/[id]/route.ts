import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withOrgContext } from '@/db/client';
import { orgMembers } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { audit } from '@/lib/audit/log';
import {
  getOrGenerateCorrelationId,
  toUserError,
} from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';

export const dynamic = 'force-dynamic';

const UpdateRoleSchema = z.object({
  role: z.enum(['admin', 'editor', 'viewer']),
});

function errorResponse(error: unknown, req: Request) {
  const correlationId = getOrGenerateCorrelationId(req);
  const appError = toUserError(error, correlationId);
  return NextResponse.json(appError, {
    status: statusFromCode(appError.code),
    headers: { 'x-correlation-id': correlationId },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req, 'org.invite');
    const { id: memberId } = await params;

    const rawBody = await req.json().catch(() => ({}));
    const parseResult = UpdateRoleSchema.safeParse(rawBody);

    if (!parseResult.success) {
      const correlationId = getOrGenerateCorrelationId(req);
      return NextResponse.json(
        {
          code: 'validation.invalid_format',
          message: parseResult.error.errors[0]?.message ?? 'Rol inválido',
          correlationId,
          retryable: false,
        },
        { status: 400, headers: { 'x-correlation-id': correlationId } },
      );
    }

    const { role: newRole } = parseResult.data;

    const result = await withOrgContext(
      ctx.orgId,
      ctx.userId,
      ctx.role,
      async (tx) => {
        const [targetMember] = await tx
          .select()
          .from(orgMembers)
          .where(
            and(eq(orgMembers.id, memberId), eq(orgMembers.orgId, ctx.orgId)),
          )
          .limit(1);

        if (!targetMember) {
          return { notFound: true };
        }

        // Si se intenta degradar a un admin, asegurar que no sea el único
        if (targetMember.role === 'admin' && newRole !== 'admin') {
          const adminCountRes = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(orgMembers)
            .where(
              and(eq(orgMembers.orgId, ctx.orgId), eq(orgMembers.role, 'admin')),
            );

          const adminCount = adminCountRes[0]?.count ?? 0;
          if (adminCount <= 1) {
            return {
              lastAdmin: true,
              message:
                'No podés cambiar el rol del único administrador de la organización.',
            };
          }
        }

        const [updated] = await tx
          .update(orgMembers)
          .set({ role: newRole })
          .where(eq(orgMembers.id, memberId))
          .returning();

        return { member: updated };
      },
    );

    if (result.notFound) {
      return NextResponse.json(
        { code: 'member.not_found', message: 'Miembro no encontrado' },
        { status: 404 },
      );
    }

    if (result.lastAdmin) {
      return NextResponse.json(
        { code: 'member.last_admin', message: result.message },
        { status: 400 },
      );
    }

    await audit(
      ctx.orgId,
      ctx.userId,
      'org.member_role_changed',
      `member:${memberId}`,
      { metadata: { newRole }, req },
    );

    return NextResponse.json({ member: result.member });
  } catch (error) {
    return errorResponse(error, req);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req, 'org.removeMember');
    const { id: memberId } = await params;

    const result = await withOrgContext(
      ctx.orgId,
      ctx.userId,
      ctx.role,
      async (tx) => {
        const [targetMember] = await tx
          .select()
          .from(orgMembers)
          .where(
            and(eq(orgMembers.id, memberId), eq(orgMembers.orgId, ctx.orgId)),
          )
          .limit(1);

        if (!targetMember) {
          return { notFound: true };
        }

        if (targetMember.role === 'admin') {
          const adminCountRes = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(orgMembers)
            .where(
              and(eq(orgMembers.orgId, ctx.orgId), eq(orgMembers.role, 'admin')),
            );

          const adminCount = adminCountRes[0]?.count ?? 0;
          if (adminCount <= 1) {
            return {
              lastAdmin: true,
              message:
                'No podés remover al único administrador de la organización.',
            };
          }
        }

        await tx.delete(orgMembers).where(eq(orgMembers.id, memberId));

        return { removedUserId: targetMember.userId };
      },
    );

    if (result.notFound) {
      return NextResponse.json(
        { code: 'member.not_found', message: 'Miembro no encontrado' },
        { status: 404 },
      );
    }

    if (result.lastAdmin) {
      return NextResponse.json(
        { code: 'member.last_admin', message: result.message },
        { status: 400 },
      );
    }

    await audit(
      ctx.orgId,
      ctx.userId,
      'org.member_removed',
      `member:${memberId}`,
      { metadata: { removedUserId: result.removedUserId }, req },
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, req);
  }
}
