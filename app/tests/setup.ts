// Vitest setup: ejecuta antes de cada test file

// ── localStorage polyfill ──────────────────────────────────────────────────────
// zustand persist middleware defaults to localStorage.
// happy-dom in vitest 3.x does NOT polyfill the full Storage interface
// (setItem/removeItem are missing), causing:
//   TypeError: Cannot read properties of undefined (reading 'setItem')
// This runs BEFORE any test module is loaded (via setupFiles), so zustand's
// persist middleware captures the correct globalThis.localStorage reference.
const ls = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => ls.get(key) ?? null,
  setItem: (key: string, value: string) => { ls.set(key, value); },
  removeItem: (key: string) => { ls.delete(key); },
  key: (_i: number) => null,
  get length() { return ls.size; },
  clear: () => { ls.clear(); },
};

// ── Mock env vars necesarios
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.BETTER_AUTH_SECRET = 'test-secret-do-not-use-in-prod-must-be-32-chars-long-yes';
process.env.LLM_KEY_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.DATABASE_READONLY_URL = 'postgresql://readonly:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

// Silenciar logs en tests
process.env.LOG_LEVEL = 'silent';