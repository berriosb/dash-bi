'use client';

import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';

/**
 * better-auth client setup (frontend).
 *
 * Sprint 1 v0.2: implementación de `auth.md §3.3`.
 * Para uso en componentes client-side de Next.js.
 *
 * Uso:
 * ```tsx
 * 'use client';
 * import { signIn, useSession } from '@/lib/auth/client';
 *
 * const { data: session } = useSession();
 * await signIn.email({ email, password });
 * ```
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  plugins: [magicLinkClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;

// Helper para magic link (no se exporta directo del client).
// Usar: await signIn.magicLink({ email, callbackURL: '/' })
export async function sendMagicLink(email: string, callbackURL = '/') {
  return signIn.magicLink({ email, callbackURL });
}