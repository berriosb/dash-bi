import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withOrgContext } from "@/db/client";
import { orgMembers, orgs, users } from "@/db/schema";
import { requireAuth } from "@/lib/auth/request";
import { ForbiddenError } from "@/lib/auth/context";
import { audit } from "@/lib/audit/log";
import {
  getOrGenerateCorrelationId,
  toUserError,
} from "@/lib/errors/to-user-error";
import { statusFromCode } from "@/lib/errors/types";

export const dynamic = "force-dynamic";

const SwitchOrganizationSchema = z.object({
  orgId: z.string().min(1).max(64),
});

function errorResponse(error: unknown, req: Request) {
  const correlationId = getOrGenerateCorrelationId(req);
  const appError = toUserError(error, correlationId);
  return NextResponse.json(appError, {
    status: statusFromCode(appError.code),
    headers: { "x-correlation-id": correlationId },
  });
}

export async function GET(req: Request) {
  try {
    const ctx = await requireAuth(req, "org.switch");
    const organizations = await withOrgContext(
      ctx.orgId,
      ctx.userId,
      ctx.role,
      async (tx) => {
        const rows = await tx
          .select({
            id: orgs.id,
            name: orgs.name,
            slug: orgs.slug,
            plan: orgs.plan,
            role: orgMembers.role,
          })
          .from(orgs)
          .innerJoin(orgMembers, eq(orgMembers.orgId, orgs.id))
          .where(eq(orgMembers.userId, ctx.userId))
          .orderBy(asc(orgs.name));

        return rows;
      },
    );

    return NextResponse.json({ organizations, activeOrgId: ctx.orgId });
  } catch (error) {
    return errorResponse(error, req);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireAuth(req, "org.switch");
    const parsed = SwitchOrganizationSchema.safeParse(await req.json());
    if (!parsed.success) {
      const correlationId = getOrGenerateCorrelationId(req);
      return NextResponse.json(
        {
          code: "validation.invalid_format",
          message: "Elegí una organización válida.",
          correlationId,
          retryable: false,
        },
        { status: 400, headers: { "x-correlation-id": correlationId } },
      );
    }

    const targetOrgId = parsed.data.orgId;
    const membership = await withOrgContext(
      ctx.orgId,
      ctx.userId,
      ctx.role,
      async (tx) => {
        const [member] = await tx
          .select({ id: orgs.id })
          .from(orgs)
          .innerJoin(orgMembers, eq(orgMembers.orgId, orgs.id))
          .where(
            and(eq(orgs.id, targetOrgId), eq(orgMembers.userId, ctx.userId)),
          )
          .limit(1);

        if (!member)
          throw new ForbiddenError("No pertenecés a esa organización.");

        await tx
          .update(users)
          .set({ activeOrgId: targetOrgId })
          .where(eq(users.id, ctx.userId));
        return member;
      },
    );

    await audit(targetOrgId, ctx.userId, "org.switched", `org:${targetOrgId}`, {
      metadata: { previousOrgId: ctx.orgId },
    });

    const response = NextResponse.json({ activeOrgId: membership.id });
    response.cookies.set("dashbi.activeOrgId", targetOrgId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return response;
  } catch (error) {
    return errorResponse(error, req);
  }
}
