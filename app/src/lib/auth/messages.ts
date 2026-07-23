/**
 * Mensajes de autenticación y emails. Centraliza i18n para Fase 2
 * (cuando se reemplace por next-intl con messages/es.json).
 *
 * Sprint 1 v0.2: implementa `auth.md §15`.
 */

export const AUTH_MESSAGES = {
  // UI messages
  loginSuccess: 'Sesión iniciada',
  loginFailed: 'Email o contraseña incorrectos',
  emailNotVerified: 'Por favor verifica tu email antes de iniciar sesión',
  magicLinkSent: 'Link mágico enviado a tu email',
  signupSuccess: 'Cuenta creada. Revisa tu email para verificar.',

  // Email subjects (parametrizados)
  magicLinkSubject: (orgName: string) => `Tu link de acceso a ${orgName} en dash-bi`,
  verifyEmailSubject: 'Verificá tu email en dash-bi',
  passwordResetSubject: 'Restablecé tu contraseña en dash-bi',

  // Email body templates
  magicLinkBody: (url: string) => `
    <p>Hacé click en el siguiente link para acceder a tu cuenta:</p>
    <p><a href="${url}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Acceder a dash-bi</a></p>
    <p style="color: #6b7280; font-size: 14px;">Este link expira en 10 minutos.</p>
  `,
  magicLinkText: (url: string) =>
    `Click este link para acceder: ${url} (expira en 10 min)`,

  verifyEmailBody: (url: string) => `
    <p>Bienvenido a dash-bi. Verificá tu email haciendo click en el siguiente link:</p>
    <p><a href="${url}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Verificar email</a></p>
    <p style="color: #6b7280; font-size: 14px;">Este link expira en 24 horas.</p>
  `,
  verifyEmailText: (url: string) =>
    `Verificá tu email: ${url} (expira en 24 horas)`,
} as const;

/**
 * Email HTML base template.
 */
const BASE_TEMPLATE = (content: string): string => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>dash-bi</title>
</head>
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

/**
 * Magic link email template.
 */
export function MagicLinkEmail(url: string, orgName: string) {
  return {
    subject: AUTH_MESSAGES.magicLinkSubject(orgName),
    html: BASE_TEMPLATE(AUTH_MESSAGES.magicLinkBody(url)),
    text: AUTH_MESSAGES.magicLinkText(url),
  };
}

/**
 * Email verification template.
 */
export function VerifyEmailEmail(url: string) {
  return {
    subject: AUTH_MESSAGES.verifyEmailSubject,
    html: BASE_TEMPLATE(AUTH_MESSAGES.verifyEmailBody(url)),
    text: AUTH_MESSAGES.verifyEmailText(url),
  };
}