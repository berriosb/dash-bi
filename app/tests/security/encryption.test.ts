import { describe, it, expect } from 'vitest';
import { encryptApiKey, decryptApiKey } from '@/lib/security/encryption';

// ⚠️ Test only: master key fija. En prod, viene de env var.
const TEST_KEY = 'a'.repeat(64); // 32 bytes hex

describe('AES-256-GCM encryption (T4 BYOK security)', () => {
  it('encrypts and decrypts round-trip', () => {
    const original = 'sk_FAKE_KEY_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const encrypted = encryptApiKey(original, TEST_KEY);
    const decrypted = decryptApiKey(encrypted, TEST_KEY);

    expect(encrypted).not.toBe(original);
    expect(Buffer.from(encrypted, 'base64').length).toBeGreaterThan(32); // iv(16) + tag(16) + cipher
    expect(decrypted).toBe(original);
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'sk_FAKE_ANT_aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const enc1 = encryptApiKey(plaintext, TEST_KEY);
    const enc2 = encryptApiKey(plaintext, TEST_KEY);

    expect(enc1).not.toBe(enc2); // Different IVs
  });

  it('fails to decrypt with wrong key', () => {
    const original = 'AIza_FAKE_KEY_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const encrypted = encryptApiKey(original, TEST_KEY);
    const wrongKey = 'b'.repeat(64);

    expect(() => decryptApiKey(encrypted, wrongKey)).toThrow();
  });

  it('rejects invalid ciphertext format', () => {
    expect(() => decryptApiKey('not-a-valid-ciphertext', TEST_KEY)).toThrow();
  });
});