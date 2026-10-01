import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/errors/response';
import { TEMPLATE_CATALOG } from '@/lib/templates/catalog';
import { requireAuth } from '@/lib/auth/request';

export async function GET(req: Request) {
  try {
    await requireAuth(req, 'dashboard.view');
    return NextResponse.json({ templates: TEMPLATE_CATALOG });
  } catch (error) {
    // This used to report EVERY failure as 401 "No autorizado". The catalog is
    // a static import, so the only realistic throw is the auth check — until
    // it isn't, and then a permission bug or a missing dependency surfaced to
    // the client as "you are not logged in", which sends debugging in exactly
    // the wrong direction.
    if (error instanceof Response) return error;
    return errorResponse(error, req);
  }
}
