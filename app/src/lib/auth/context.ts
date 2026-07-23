import { eq, and } from 'drizzle-orm';
import { db } from '@/db/client';
import { orgMembers } from '@/db/schema';
import { hasPermission, type OrgRole } from './permissions';

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

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class BadRequestError extends Error {
  constructor(message = 'Bad Request') {
    super(message);
    this.name = 'BadRequestError';
  }
}

export async function requirePermission(
  userId: string,
  orgId: string,
  action: string
): Promise<OrgRole> {
  const member = await db.query.orgMembers.findFirst({
    where: and(
      eq(orgMembers.userId, userId),
      eq(orgMembers.orgId, orgId)
    ),
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
