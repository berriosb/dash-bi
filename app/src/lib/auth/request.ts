import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth/config';
import { db } from '@/db/client';
import { eq, and, sql } from 'drizzle-orm';
import { orgMembers } from '@/db/schema';
import { hasPermission, type OrgRole } from './permissions';
import { UnauthorizedError, ForbiddenError } from './context';

export type AuthContext = {
  userId: string;
  email: string;
  orgId: string;
  role: OrgRole;
};

/**
 * Resolve the authenticated context for a request.
 *
 * Sprint 1.5 — security fix:
 * Antes, las API routes leían `x-user-id` y `x-org-id` directamente
 * del request, lo que permitía impersonar a cualquier user enviando
 * headers arbitrarios. Este helper consulta `better-auth` para validar
 * criptográficamente la sesión y deriva `userId` + `orgId` + `role`
 * de la DB, ignorando los headers del cliente.
 *
 * Flujo:
 * 1. `auth.api.getSession({ headers })` valida la cookie de sesión.
 *    Si no hay sesión válida → `UnauthorizedError`.
 * 2. Si el cliente envió `x-org-id` distinto al `activeOrgId` del user,
 *    usamos el del cliente como override explícito (es el patrón de
 *    "switch de organización" que el OrgSwitcher necesita). El rol se
 *    vuelve a verificar contra `org_members` en cada request.
 * 3. Membership + permission check vía `requirePermission`-style lookup.
 */
export async function getAuthContext(
  req: Request | NextRequest,
): Promise<AuthContext> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    throw new UnauthorizedError('No active session');
  }

  const userId = session.user.id;
  const email = session.user.email;

  const requestedOrgId =
    req.headers.get('x-org-id') ??
    (req as NextRequest).cookies?.get('dashbi.activeOrgId')?.value ??
    null;

  const member = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
    const [row] = await tx
      .select()
      .from(orgMembers)
      .where(
        requestedOrgId
          ? and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, requestedOrgId))
          : eq(orgMembers.userId, userId),
      )
      .limit(1);
    return row;
  });

  if (!member) {
    throw new ForbiddenError('Not a member of the requested organization');
  }

  return {
    userId,
    email,
    orgId: member.orgId,
    role: member.role as OrgRole,
  };
}

/**
 * Like `getAuthContext` but enforces a specific action against the
 * resolved role. Returns the full context so callers can use `userId`/
 * `orgId` for subsequent operations.
 */
export async function requireAuth(
  req: Request | NextRequest,
  action: string,
): Promise<AuthContext> {
  const ctx = await getAuthContext(req);
  if (!hasPermission(ctx.role, action)) {
    throw new ForbiddenError(`Role '${ctx.role}' cannot perform '${action}'`);
  }
  return ctx;
}

export type { OrgRole };