import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { withOrgContext } from '@/db/client';
import { orgMembers, users } from '@/db/schema';
import { requireAuth } from '@/lib/auth/request';
import { audit } from '@/lib/audit/log';
import {
  getOrGenerateCorrelationId,
  toUserError,
} from '@/lib/errors/to-user-error';
import { statusFromCode } from '@/lib/errors/types';

export const dynamic = 'force-dynamic';

const InviteMemberSchema = z.object({
  email: z.string().email('Email inválido'),
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

export async function GET(req: Request) {
  try {
    const ctx = await requireAuth(req, 'org.switch');

    const members = await withOrgContext(
      ctx.orgId,
      ctx.userId,
      ctx.role,
      async (tx) => {
        const rows = await tx
          .select({
            id: orgMembers.id,
            userId: orgMembers.userId,
            role: orgMembers.role,
            joinedAt: orgMembers.joinedAt,
            invitedAt: orgMembers.invitedAt,
            createdAt: orgMembers.createdAt,
            email: users.email,
            name: users.name,
            avatarUrl: users.avatarUrl,
          })
          .from(orgMembers)
          .innerJoin(users, eq(users.id, orgMembers.userId))
          .where(eq(orgMembers.orgId, ctx.orgId))
          .orderBy(asc(orgMembers.createdAt));

        return rows;
      },
    );

    return NextResponse.json({
      members,
      currentUserId: ctx.userId,
      currentUserRole: ctx.role,
    });
  } catch (error) {
    return errorResponse(error, req);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireAuth(req, 'org.invite');
    const rawBody = await req.json().catch(() => ({}));
    const parseResult = InviteMemberSchema.safeParse(rawBody);

    if (!parseResult.success) {
      const correlationId = getOrGenerateCorrelationId(req);
      return NextResponse.json(
        {
          code: 'validation.invalid_format',
          message: parseResult.error.errors[0]?.message ?? 'Datos inválidos',
          correlationId,
          retryable: false,
        },
        { status: 400, headers: { 'x-correlation-id': correlationId } },
      );
    }

    const { email, role } = parseResult.data;
    const normalizedEmail = email.toLowerCase().trim();

    const result = await withOrgContext(
      ctx.orgId,
      ctx.userId,
      ctx.role,
      async (tx) => {
        // Buscar o crear usuario
        const [existingUser] = await tx
          .select()
          .from(users)
          .where(eq(users.email, normalizedEmail))
          .limit(1);

        let targetUser = existingUser;
        if (!targetUser) {
          const [newUser] = await tx
            .insert(users)
            .values({
              email: normalizedEmail,
              name: normalizedEmail.split('@')[0],
              emailVerified: false,
            })
            .returning();
          targetUser = newUser;
        }

        if (!targetUser) {
          throw new Error('No se pudo registrar el usuario para invitar');
        }

        // Verificar si ya pertenece a la organización
        const [existingMembership] = await tx
          .select()
          .from(orgMembers)
          .where(
            and(
              eq(orgMembers.orgId, ctx.orgId),
              eq(orgMembers.userId, targetUser.id),
            ),
          )
          .limit(1);

        if (existingMembership) {
          return {
            conflict: true,
            message: 'El usuario ya es miembro de esta organización.',
          };
        }

        const [createdMember] = await tx
          .insert(orgMembers)
          .values({
            orgId: ctx.orgId,
            userId: targetUser.id,
            role,
            invitedBy: ctx.userId,
            joinedAt: new Date(),
          })
          .returning();

        return {
          conflict: false,
          member: {
            ...createdMember,
            email: targetUser.email,
            name: targetUser.name,
            avatarUrl: targetUser.avatarUrl,
          },
        };
      },
    );

    if (result.conflict) {
      const correlationId = getOrGenerateCorrelationId(req);
      return NextResponse.json(
        {
          code: 'member.already_exists',
          message: result.message,
          correlationId,
          retryable: false,
        },
        { status: 409, headers: { 'x-correlation-id': correlationId } },
      );
    }

    await audit(
      ctx.orgId,
      ctx.userId,
      'org.member_invited',
      `user:${result.member?.userId}`,
      { metadata: { role, email: normalizedEmail }, req },
    );

    return NextResponse.json({ member: result.member }, { status: 201 });
  } catch (error) {
    return errorResponse(error, req);
  }
}
