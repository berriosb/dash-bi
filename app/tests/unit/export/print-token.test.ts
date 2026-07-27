import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRedisSet, mockRedisGet, mockRedisDel } = vi.hoisted(() => ({
  mockRedisSet: vi.fn(),
  mockRedisGet: vi.fn(),
  mockRedisDel: vi.fn(),
}));

const mockRedisInstance = {
  set: mockRedisSet,
  get: mockRedisGet,
  del: mockRedisDel,
};

vi.mock('ioredis', () => ({
  default: vi.fn(() => mockRedisInstance),
  Redis: vi.fn(() => mockRedisInstance),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { generatePrintToken, validatePrintToken } from '@/lib/export/print-token';

describe('print-token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
  });

  describe('generatePrintToken', () => {
    it('returns a URL-safe token with at least 32 characters', async () => {
      const token = await generatePrintToken('dash-1', 'org-1');
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBeGreaterThanOrEqual(32);
    });

    it('stores token payload in Redis with 30-minute TTL keyed by token', async () => {
      const token = await generatePrintToken('dash-1', 'org-1');

      expect(mockRedisSet).toHaveBeenCalledTimes(1);
      const [key, value, mode, ttl] = mockRedisSet.mock.calls[0];
      expect(key).toBe(`print:${token}`);
      const payload = JSON.parse(value);
      expect(payload).toMatchObject({ dashboardId: 'dash-1', orgId: 'org-1' });
      expect(mode).toBe('EX');
      expect(ttl).toBe(30 * 60);
    });

    it('returns unique tokens on each call', async () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 50; i++) {
        tokens.add(await generatePrintToken('dash-1', 'org-1'));
      }
      expect(tokens.size).toBe(50);
    });
  });

  describe('validatePrintToken', () => {
    it('returns null when token is unknown', async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      const result = await validatePrintToken('unknown-token');
      expect(result).toBeNull();
      expect(mockRedisDel).not.toHaveBeenCalled();
    });

    it('returns payload and deletes token (single-use) when valid', async () => {
      const payload = { dashboardId: 'dash-1', orgId: 'org-1' };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(payload));

      const result = await validatePrintToken('valid-token');

      expect(result).toEqual(payload);
      expect(mockRedisDel).toHaveBeenCalledTimes(1);
      expect(mockRedisDel).toHaveBeenCalledWith('print:valid-token');
    });

    it('returns null and does not delete when redis get returns malformed JSON', async () => {
      mockRedisGet.mockResolvedValueOnce('not-json{');
      const result = await validatePrintToken('bad-token');
      expect(result).toBeNull();
      expect(mockRedisDel).not.toHaveBeenCalled();
    });
  });
});