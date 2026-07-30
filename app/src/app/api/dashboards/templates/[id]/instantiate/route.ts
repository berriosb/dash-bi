import { NextResponse } from 'next/server';
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
    const message = error instanceof Error ? error.message : 'Error al instanciar plantilla';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
