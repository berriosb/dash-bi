# Spec: Authentication

> Flujo de autenticación con better-auth. Login email/password + magic links + OAuth (Google). Sesiones persistentes, multi-org support.

**Status:** Draft v0.2 (sync 2026-07-21)
**Prioridad:** P0 — sin auth no hay producto
**Responsable:** codehak
**Depende de:** `multi-tenant.md`

---

## Cambios respecto a v0.1 (sync 2026-07-21)

**v0.2 (correcciones de consistencia):**
- ✅ Bug de template literal corregido en §4 (la línea de magic link HTML tenía una mezcla de backticks)
- ✅ Decisión de i18n documentada: español monolingüe MVP (ver `SPEC.md` §11)
- ✅ `requireEmailVerification` cambiado a `true` desde día 1 (recomendado por auditoría)
- ✅ Stack de forms documentado: `react-hook-form` + Zod
- ✅ Custom rate limits expandidos (todos los endpoints auth, no solo 3)

---

## 1. Objetivo

Implementar autenticación que:

1. **Soporte email + password** con hash seguro (bcrypt o argon2)
2. **Soporte magic links** (passwordless) — útil para empresas que bloquean password managers
3. **Soporte OAuth Google** — onboarding rápido, importante para Sheets connector
4. **Cree sesión persistente** (cookie HTTP-only, secure)
5. **Soporte multi-org** — un usuario puede estar en múltiples orgs
6. **Rate limiting** — protección contra brute force
7. **Audit log** — login/logout/failed attempts

## 2. Stack: better-auth

**Por qué better-auth sobre NextAuth/Auth.js:**
- Más moderno (2025+), mantenido activamente
- TypeScript-first, mejor DX
- Soporte nativo para multi-tenant orgs
- Magic links + OAuth + email/password out-of-the-box
- Más liviano (no depende de 50 paquetes)

## 3. Setup

### 3.1 Instalación

```bash
pnpm add better-auth
pnpm add @better-auth/cli
```

### 3.2 Configuración

```typescript
// lib/auth/config.ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import { db } from '@/lib/db/client';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,    // v0.2: requerido desde día 1
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: false,                 // signin solo después de verificar email
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      scope: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/spreadsheets.readonly'],
    },
  },

  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        const tpl = MagicLinkEmail(url, 'tu organización');
        await sendEmail({
          to: email,
          subject: tpl.subject,            // v0.2 fix: usa subject del template (parametrizado)
          html: tpl.html,
        });
      },
      expiresIn: 600,  // 10 minutos
    }),
  ],

  session: {
    expiresIn: 60 * 60 * 24 * 30,    // 30 días
    updateAge: 60 * 60 * 24,         // refresh cada 24h
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,                 // 5 minutos
    },
  },

  rateLimit: {
    enabled: true,
    window: 60,                       // 1 minuto
    max: 30,                          // 30 requests por ventana (global)
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },     // 5 attempts/min
      '/sign-up/email': { window: 60, max: 3 },     // 3 signups/min
      '/magic-link/send': { window: 60, max: 3 },   // 3 magic links/min
      '/forgot-password': { window: 60, max: 3 },   // v0.2: password reset limitado
      '/reset-password': { window: 60, max: 5 },    // v0.2: idem
      '/verify-email': { window: 60, max: 10 },     // v0.2: verificación post-signup
    },
  },

  advanced: {
    cookiePrefix: 'dashbi',
    useSecureCookies: process.env.NODE_ENV === 'production',
  },
});
```

> **v0.2 fix:** el ejemplo original tenía un bug — `\`<a href="${url}">Click aquí para acceder</a>\`` mezclaba template literals de manera inválida. Ahora usa el template de `MagicLinkEmail` definido en `email.md` §3 / §5.

### 3.3 Client setup

```typescript
// lib/auth/client.ts
import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [magicLinkClient()],
});

export const {
  signIn,
  signOut,
  signUp,
  useSession,
  sendMagicLink,
} = authClient;
```

## 4. Email templates

```typescript
// lib/auth/emails.ts

const BASE_TEMPLATE = (content: string) => `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"><title>dash-bi</title></head>
  <body style="font-family: -apple-system, system-ui, sans-serif; background: #f9fafb; padding: 40px;">
    <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <h1 style="margin: 0 0 24px; font-size: 24px; color: #111827;">dash-bi</h1>
      ${content}
      <hr style="margin: 32px 0; border: none; border-top: 1px solid #e5e7eb;" />
      <p style="font-size: 12px; color: #6b7280;">
        Si no solicitaste este email, podés ignorarlo.
      </p>
    </div>
  </body>
  </html>
`;

// v0.2 fix: usa el subject desde AUTH_MESSAGES (§15) — centraliza i18n
import { AUTH_MESSAGES } from './messages';

export const MAGIC_LINK_EMAIL = (url: string, orgName: string) => ({
  subject: AUTH_MESSAGES.magicLinkSubject(orgName),  // 'Tu link de acceso a ${orgName} en dash-bi'
  html: BASE_TEMPLATE(`
    <p>Click en el siguiente link para acceder a tu cuenta:</p>
    <p><a href="${url}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Acceder a dash-bi</a></p>
    <p style="color: #6b7280; font-size: 14px;">Este link expira en 10 minutos.</p>
  `),
  text: `Click este link para acceder: ${url} (expira en 10 min)`,
});
```

## 5. Flujos UX

### 5.1 Signup

```
1. Usuario va a /signup
2. Form: name + email + password (o "Continuar con Google")
3. Submit → API call
4. Si email: crea cuenta, auto-login, redirige a /onboarding
5. Si Google: OAuth flow → callback → /onboarding
```

### 5.2 Login

```
1. Usuario va a /login
2. Form: email + password (o "Continuar con Google" o "Enviar magic link")
3. Submit → API call
4. Éxito: redirige a /dashboard (última org activa o selector)
5. Si falla: mensaje de error
```

### 5.3 Magic link

```
1. Usuario click "Enviar magic link" en /login
2. Ingresa email → click "Enviar"
3. Email llega con link (10 min expiration)
4. Click link → magic-link/[token]
5. Auto-login → redirige a /dashboard
```

### 5.4 Multi-org switcher

```
1. Usuario con sesión activa va a /dashboard
2. Top nav muestra: org actual + dropdown
3. Click → lista de orgs del usuario + opción "Crear nueva"
4. Click otra org → refresh con nuevo orgId en header
```

## 6. Páginas

```
/login                  → email/password + magic link + Google
/signup                 → registro nuevo
/magic-link/[token]      → callback magic link
/dashboard              → home (requiere auth)
/onboarding             → primer login (crear org, conectar data source)
/forgot-password        → reset password (Fase 2)
/reset-password/[token] → reset callback (Fase 2)
```

## 7. Middleware de Next.js

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/config';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  
  // Rutas públicas
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/magic-link') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/share/')      // links públicos
  ) {
    return NextResponse.next();
  }
  
  // Verificar sesión
  const session = await getSession({ headers: req.headers });
  
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

## 8. Org context en cliente

```typescript
// app/org-switcher.tsx
'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth/client';

export function OrgSwitcher() {
  const { data: session } = useSession();
  const [orgs, setOrgs] = useState(orgs);
  const [activeOrg, setActiveOrg] = useState(session.user.activeOrgId);
  
  const switchOrg = async (orgId: string) => {
    await fetch('/api/orgs/switch', {
      method: 'POST',
      body: JSON.stringify({ orgId }),
    });
    setActiveOrg(orgId);
    window.location.reload();
  };
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        {orgs.find(o => o.id === activeOrg)?.name}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {orgs.map(org => (
          <DropdownMenuItem onClick={() => switchOrg(org.id)}>
            {org.name}
            {org.id === activeOrg && ' ✓'}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

## 9. Sesión activa por org

```typescript
// db/schema.ts

// En users, agregar campo active_org_id
export const users = pgTable('users', {
  // ...
  activeOrgId: uuid('active_org_id').references(() => orgs.id),
});
```

Cuando un usuario cambia de org, se actualiza `users.activeOrgId`. La próxima request usa ese orgId como default.

## 10. Acceptance criteria

- [ ] Signup con email + password funciona
- [ ] Signup con Google funciona (OAuth flow)
- [ ] Login con email + password funciona
- [ ] Magic link funciona (envío + click + auto-login)
- [ ] Logout funciona (limpia cookie + invalida server-side)
- [ ] Sesión persiste 30 días con refresh automático
- [ ] Middleware protege rutas privadas
- [ ] Multi-org funciona (un usuario en 2+ orgs puede switchear)
- [ ] Rate limiting en login (5 attempts/min)
- [ ] Audit log guarda: login, logout, signup, magic_link_used
- [ ] Password nunca se loguea ni aparece en responses
- [ ] Cookie es HTTP-only + Secure (HTTPS only)

## 11. Out of scope (MVP)

- ❌ 2FA / TOTP (Fase 2)
- ❌ SSO/SAML (Fase 2)
- ❌ Password reset flow completo (Fase 2)
- ❌ Apple/Microsoft OAuth (Fase 2)
- ❌ Session management UI (ver devices activos) (Fase 2)
- ❌ WebAuthn / passkeys (Fase 3)

## 12. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Brute force en login | Rate limit 5/min + lockout después de 10 fails |
| Magic link interceptado | HTTPS only + token único + expiración 10 min |
| OAuth credential leak | Secrets en env, nunca en código |
| Sesión robada (XSS) | HTTP-only cookies + CSP strict |
| Password débil | Mínimo 8 chars + sugerencias en UI (Fase 2: zxcvbn) |
| Audit log crece | Particionado + retention 90 días |
| better-auth cambia API | Pin versión, actualizar con breaking changes |

## 13. Dependencias

```json
{
  "dependencies": {
    "better-auth": "^1.2.0",
    "drizzle-orm": "^0.38.0",
    "postgres": "^3.4.5",
    "react-hook-form": "^7.54.0",
    "@hookform/resolvers": "^3.10.0",
    "zod": "^3.24.0"
  }
}
```

## 14. Stack de forms (v0.2)

Todos los forms de auth (signup, login, magic-link, reset) usan:

- **`react-hook-form`** — performance, no re-render
- **`@hookform/resolvers/zod`** — validación compartida con el schema del backend
- **Schemas Zod únicos** en `lib/auth/schemas.ts`, reusados en frontend y backend

```typescript
// lib/auth/schemas.ts
import { z } from 'zod';

export const SignupSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
});

export const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});
```

Estos schemas se importan tanto en `app/login/page.tsx` (frontend) como en el route handler de better-auth. Una validación, dos usos.

## 15. i18n (v0.2)

MVP monolingüe español (ver `SPEC.md` §11). Todos los mensajes de error de auth, copy de emails, y labels de UI están en español:

```typescript
// lib/auth/messages.ts
export const AUTH_MESSAGES = {
  loginSuccess: 'Sesión iniciada',
  loginFailed: 'Email o contraseña incorrectos',
  emailNotVerified: 'Por favor verifica tu email antes de iniciar sesión',
  magicLinkSent: 'Link mágico enviado a tu email',
  signupSuccess: 'Cuenta creada. Revisa tu email para verificar.',
  // Helper para subjects parametrizados
  magicLinkSubject: (orgName: string) => `Tu link de acceso a ${orgName} en dash-bi`,
  verifyEmailSubject: 'Verificá tu email en dash-bi',
  passwordResetSubject: 'Restablecé tu contraseña en dash-bi',
};
```

Fase 2 se reemplaza por `next-intl` con `messages/es.json`.

## 16. Specs relacionados

- `multi-tenant.md` — orgs + members + RLS
- `connectors.md` — Google OAuth usado para Sheets
- `ai-generate-dashboards.md` — sesión requerida para usar
- `email.md` — templates de magic link y verificación