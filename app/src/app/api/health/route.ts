import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';

// Health check endpoint (no auth, used by Docker + load balancers)
export async function GET() {
  const checks = {
    status: 'ok' as 'ok' | 'degraded' | 'down',
    timestamp: new Date().toISOString(),
    service: 'dash-bi',
    version: process.env.VERSION ?? '0.1.0',
    services: {
      postgres: { ok: false, latencyMs: null as number | null },
      redis: { ok: false, latencyMs: null as number | null },
    },
  };

  // Check Postgres
  const pgStart = Date.now();
  try {
    await db.execute(sql`SELECT 1 as ok`);
    checks.services.postgres = { ok: true, latencyMs: Date.now() - pgStart };
  } catch {
    checks.status = 'down';
    checks.services.postgres = { ok: false, latencyMs: Date.now() - pgStart };
  }

  // Check Redis
  const redisStart = Date.now();
  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 1000, lazyConnect: false });
    await redis.ping();
    await redis.quit();
    checks.services.redis = { ok: true, latencyMs: Date.now() - redisStart };
  } catch {
    checks.services.redis = { ok: false, latencyMs: Date.now() - redisStart };
    if (checks.status === 'ok') checks.status = 'degraded';
  }

  const httpStatus = checks.status === 'ok' ? 200 : checks.status === 'degraded' ? 200 : 503;
  return NextResponse.json(checks, {
    status: httpStatus,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}