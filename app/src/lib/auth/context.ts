import { eq, and } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { orgMembers } from '@/db/schema';
import { hasPermission, type OrgRole } from './permissions';
import { ForbiddenError } from './errors';

export type AuthContext = {
  userId: string;
  email: string;
  orgId: string;
  role: OrgRole;
};

export class UnauthorizedError extends Error {
  constructor(message = 'Not authenticated') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class BadRequestError extends Error {
  constructor(message = 'Bad Request') {
    super(message);
    this.name = 'BadRequestError';
  }
}

// Re-export for callers that imported from the original module.
export { ForbiddenError } from './errors';

/**
 * Verify the user is a member of the org with the requested permission.
 *
 * MUST be called with the transactional handle from `withOrgContext`
 * (or any tx whose `app.current_user_id` and `app.current_org_id`
 * GUCs have been SET LOCAL). Otherwise the `org_members_isolation`
 * RLS policy will hide the membership row and every protected request
 * becomes a 403.
 */
export async function requirePermission(
  tx: Pick<Tx, 'query'>,
  userId: string,
  orgId: string,
  action: string,
): Promise<OrgRole> {
  const member = await tx.query.orgMembers.findFirst({
    where: and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, orgId)),
  });

  if (!member) {
    throw new ForbiddenError('Not a member of this organization');
  }

  const role = member.role as OrgRole;
  if (!hasPermission(role, action)) {
    throw new ForbiddenError(`Role '${role}' cannot perform '${action}'`);
  }

  return role;
}