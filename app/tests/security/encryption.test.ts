import { describe, it, expect } from 'vitest';
import { encryptApiKey, decryptApiKey } from '@/lib/security/encryption';

// ⚠️ Test only: master key fija. En prod, viene de env var.
const TEST_KEY = 'a'.repeat(64); // 32 bytes hex

const FAKE_OPENAI_KEY = 'sk_FAKE_KEY_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FAKE_ANTHROPIC_KEY = 'sk_FAKE_ANT_aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FAKE_GOOGLE_KEY = 'AIza_FAKE_KEY_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('AES-256-GCM encryption (T4 BYOK security)', () => {
  it('encrypts and decrypts round-trip', () => {
    const encrypted = encryptApiKey(FAKE_OPENAI_KEY, TEST_KEY);
    const decrypted = decryptApiKey(encrypted, TEST_KEY);

    expect(encrypted).not.toBe(FAKE_OPENAI_KEY);
    expect(Buffer.from(encrypted, 'base64').length).toBeGreaterThan(32); // iv(16) + tag(16) + cipher
    expect(decrypted).toBe(FAKE_OPENAI_KEY);
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const enc1 = encryptApiKey(FAKE_ANTHROPIC_KEY, TEST_KEY);
    const enc2 = encryptApiKey(FAKE_ANTHROPIC_KEY, TEST_KEY);

    expect(enc1).not.toBe(enc2); // Different IVs
  });

  it('fails to decrypt with wrong key', () => {
    const encrypted = encryptApiKey(FAKE_GOOGLE_KEY, TEST_KEY);
    const wrongKey = 'b'.repeat(64);

    expect(() => decryptApiKey(encrypted, wrongKey)).toThrow();
  });

  it('rejects invalid ciphertext format', () => {
    expect(() => decryptApiKey('not-a-valid-ciphertext', TEST_KEY)).toThrow();
  });
});