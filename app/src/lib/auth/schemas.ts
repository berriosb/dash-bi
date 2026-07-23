import { z } from 'zod';

/**
 * Schemas Zod compartidos para autenticación.
 *
 * Sprint 1 v0.2: implementación de `auth.md §14`.
 * Schemas únicos en `lib/auth/schemas.ts`, reusados en frontend
 * (react-hook-form + @hookform/resolvers/zod) y backend.
 */

export const SignupSchema = z.object({
  name: z.string().min(2, 'Nombre debe tener al menos 2 caracteres').max(100),
  email: z.string().email('Email inválido').max(254),
  password: z.string().min(8, 'Contraseña debe tener al menos 8 caracteres').max(128),
});

export const LoginSchema = z.object({
  email: z.string().email('Email inválido').max(254),
  password: z.string().min(1, 'Contraseña requerida').max(128),
});

export const MagicLinkRequestSchema = z.object({
  email: z.string().email('Email inválido').max(254),
});

export const UpdatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(8, 'Mínimo 8 caracteres').max(128),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  });

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Email inválido').max(254),
});

export const ResetPasswordSchema = z
  .object({
    token: z.string().min(1),
    newPassword: z.string().min(8, 'Mínimo 8 caracteres').max(128),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  });

export type SignupInput = z.infer<typeof SignupSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type MagicLinkRequestInput = z.infer<typeof MagicLinkRequestSchema>;
export type UpdatePasswordInput = z.infer<typeof UpdatePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;