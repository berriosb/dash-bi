import crypto from 'node:crypto';

// T4 del threat model: AES-256-GCM para cifrar API keys del usuario (BYOK)
// Master key viene de env var, NO se commitea

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;   // bytes
const AUTH_TAG_LENGTH = 16; // bytes

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionError';
  }
}

/**
 * Cifra un string (API key) con AES-256-GCM.
 * 
 * Output format: base64(iv:authTag:ciphertext)
 * - iv: 16 bytes random
 * - authTag: 16 bytes (verifica integridad)
 * - ciphertext: variable
 */
export function encryptApiKey(
  plaintext: string,
  masterKey: string = process.env.LLM_KEY_ENCRYPTION_KEY || '',
): string {
  if (!masterKey || masterKey.length !== 64) {
    throw new EncryptionError('Master key must be 32 bytes (64 hex chars)');
  }

  const key = Buffer.from(masterKey, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Concatenar: iv + authTag + ciphertext, luego base64
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Descifra un string previamente cifrado con encryptApiKey.
 * 
 * Falla con error si:
 * - Formato inválido
 * - Master key incorrecta
 * - Datos corruptos (auth tag mismatch)
 */
export function decryptApiKey(
  ciphertext: string,
  masterKey: string = process.env.LLM_KEY_ENCRYPTION_KEY || '',
): string {
  if (!masterKey || masterKey.length !== 64) {
    throw new EncryptionError('Master key must be 32 bytes (64 hex chars)');
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(ciphertext, 'base64');
  } catch {
    throw new EncryptionError('Invalid ciphertext format');
  }

  if (buffer.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new EncryptionError('Ciphertext too short');
  }

  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const key = Buffer.from(masterKey, 'hex');

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return decipher.update(encrypted) + decipher.final('utf8');
  } catch {
    throw new EncryptionError('Decryption failed (wrong key or corrupted data)');
  }
}