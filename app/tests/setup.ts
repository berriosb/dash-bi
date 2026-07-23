// Vitest setup: ejecuta antes de cada test file

// Mock env vars necesarios
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.BETTER_AUTH_SECRET = 'test-secret-do-not-use-in-prod-must-be-32-chars-long-yes';
process.env.LLM_KEY_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.DATABASE_READONLY_URL = 'postgresql://readonly:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';

// Silenciar logs en tests
process.env.LOG_LEVEL = 'silent';