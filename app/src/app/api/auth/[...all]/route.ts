import { auth } from '@/lib/auth/config';
import { NextResponse } from 'next/server';

/**
 * Catch-all handler para better-auth.
 *
 * Sprint 1 v0.2: implementación de `auth.md §3`.
 *
 * Mount en `/api/auth/*` → better-auth maneja:
 * - /api/auth/sign-up/email (POST)
 * - /api/auth/sign-in/email (POST)
 * - /api/auth/sign-out (POST)
 * - /api/auth/session (GET)
 * - /api/auth/magic-link/send (POST)
 * - /api/auth/magic-link/verify (GET)
 * - /api/auth/google (GET — OAuth flow)
 * - /api/auth/google/callback (GET)
 * - /api/auth/verify-email (GET)
 * - /api/auth/forgot-password (POST)
 * - /api/auth/reset-password (POST)
 * - etc.
 *
 * Ver https://better-auth.com/docs/api-reference para la lista completa.
 */

async function handler(req: Request) {
  // better-auth returns Web Response objects that Next.js handles directly.
  return auth.handler(req);
}

export { handler as GET, handler as POST };

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}