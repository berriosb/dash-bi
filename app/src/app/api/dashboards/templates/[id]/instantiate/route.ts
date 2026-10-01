import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors/response';
import { requireAuth } from '@/lib/auth/request';
import { instantiateTemplate } from '@/lib/templates/service';
import { z } from 'zod';

const InstantiateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  dataSourceId: z.string().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req, 'dashboard.create');
    const { id: templateId } = await params;
    const body = await req.json().catch(() => ({}));
    const parseResult = InstantiateSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Datos de solicitud inválidos', details: parseResult.error.errors },
        { status: 400 },
      );
    }

    const dashboard = await instantiateTemplate({
      templateId,
      orgId: ctx.orgId,
      userId: ctx.userId,
      title: parseResult.data.title,
      dataSourceId: parseResult.data.dataSourceId,
    });

    return NextResponse.json({ dashboard }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    // This used to forward `error.message` verbatim to the client under a hard
    // 400. Whatever `instantiateTemplate` threw — a Postgres constraint name, a
    // connection string fragment, a stack-shaped driver message — went out over
    // the wire, and always with a 400 even when the real failure was a 404 or a
    // 500. `toUserError` maps known codes and sanitises the rest.
    return errorResponse(error, req);
  }
}
