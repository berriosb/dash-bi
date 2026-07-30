import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/health/route';
import { db } from '@/db/client';

vi.mock('@/db/client', () => ({
  db: {
    execute: vi.fn(),
  },
}));

vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      ping: vi.fn().mockResolvedValue('PONG'),
      quit: vi.fn().mockResolvedValue('OK'),
    })),
  };
});

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns status ok (200) when postgres and redis are healthy', async () => {
    (db.execute as any).mockResolvedValue([{ ok: 1 }]);

    const res = await GET();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe('ok');
    expect(json.service).toBe('dash-bi');
    expect(json.services.postgres.ok).toBe(true);
    expect(json.services.redis.ok).toBe(true);
  });

  it('returns degraded status (200) when redis fails but postgres is healthy', async () => {
    (db.execute as any).mockResolvedValue([{ ok: 1 }]);
    const RedisMock = (await import('ioredis')).default;
    (RedisMock as any).mockImplementationOnce(() => ({
      ping: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
      quit: vi.fn().mockResolvedValue('OK'),
    }));

    const res = await GET();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe('degraded');
    expect(json.services.postgres.ok).toBe(true);
    expect(json.services.redis.ok).toBe(false);
  });

  it('returns status down (503) when postgres fails', async () => {
    (db.execute as any).mockRejectedValue(new Error('DB down'));

    const res = await GET();
    expect(res.status).toBe(503);

    const json = await res.json();
    expect(json.status).toBe('down');
    expect(json.services.postgres.ok).toBe(false);
  });
});
