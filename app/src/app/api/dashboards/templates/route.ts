import { NextResponse } from 'next/server';
import { TEMPLATE_CATALOG } from '@/lib/templates/catalog';
import { requireAuth } from '@/lib/auth/request';

export async function GET(req: Request) {
  try {
    await requireAuth(req, 'dashboard.view');
    return NextResponse.json({ templates: TEMPLATE_CATALOG });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
}
