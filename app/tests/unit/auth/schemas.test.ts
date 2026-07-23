import { describe, it, expect } from 'vitest';
import {
  SignupSchema,
  LoginSchema,
  MagicLinkRequestSchema,
  UpdatePasswordSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
} from '@/lib/auth/schemas';

describe('Auth Zod schemas', () => {
  describe('SignupSchema', () => {
    it('accepts valid signup', () => {
      const result = SignupSchema.safeParse({
        name: 'Bastián',
        email: 'bastian@example.com',
        password: 'secret123',
      });
      expect(result.success).toBe(true);
    });

    it('rejects name < 2 chars', () => {
      const result = SignupSchema.safeParse({
        name: 'B',
        email: 'b@example.com',
        password: 'secret123',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.path[0] === 'name')).toBe(true);
      }
    });

    it('rejects password < 8 chars', () => {
      const result = SignupSchema.safeParse({
        name: 'Bastián',
        email: 'b@example.com',
        password: 'short',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid email', () => {
      const result = SignupSchema.safeParse({
        name: 'Bastián',
        email: 'not-an-email',
        password: 'secret123',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('LoginSchema', () => {
    it('accepts valid login', () => {
      expect(LoginSchema.safeParse({ email: 'a@b.com', password: 'x' }).success).toBe(true);
    });

    it('rejects empty password', () => {
      const result = LoginSchema.safeParse({ email: 'a@b.com', password: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('MagicLinkRequestSchema', () => {
    it('accepts valid email', () => {
      expect(MagicLinkRequestSchema.safeParse({ email: 'a@b.com' }).success).toBe(true);
    });

    it('rejects invalid email', () => {
      expect(MagicLinkRequestSchema.safeParse({ email: 'bad' }).success).toBe(false);
    });
  });

  describe('UpdatePasswordSchema', () => {
    it('accepts matching new passwords', () => {
      const result = UpdatePasswordSchema.safeParse({
        currentPassword: 'oldsecret',
        newPassword: 'newsecret1',
        confirmPassword: 'newsecret1',
      });
      expect(result.success).toBe(true);
    });

    it('rejects mismatched confirm', () => {
      const result = UpdatePasswordSchema.safeParse({
        currentPassword: 'oldsecret',
        newPassword: 'newsecret1',
        confirmPassword: 'different',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.path[0] === 'confirmPassword')).toBe(true);
      }
    });

    it('rejects too-short new password', () => {
      const result = UpdatePasswordSchema.safeParse({
        currentPassword: 'oldsecret',
        newPassword: 'short',
        confirmPassword: 'short',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ForgotPasswordSchema / ResetPasswordSchema', () => {
    it('forgot accepts valid email', () => {
      expect(ForgotPasswordSchema.safeParse({ email: 'a@b.com' }).success).toBe(true);
    });

    it('reset accepts token + matching new password', () => {
      const result = ResetPasswordSchema.safeParse({
        token: 'abc',
        newPassword: 'newpass1',
        confirmPassword: 'newpass1',
      });
      expect(result.success).toBe(true);
    });

    it('reset rejects mismatched new password', () => {
      const result = ResetPasswordSchema.safeParse({
        token: 'abc',
        newPassword: 'newpass1',
        confirmPassword: 'different',
      });
      expect(result.success).toBe(false);
    });
  });
});