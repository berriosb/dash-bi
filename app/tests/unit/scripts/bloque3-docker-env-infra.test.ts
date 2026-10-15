import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const APP_ROOT = resolve(__dirname, '../../..');

describe('Bloque 3 — Docker, Environment & CI Readiness', () => {
  it('copies vendor/ before pnpm install in both Dockerfile and Dockerfile.worker', () => {
    const dockerfile = readFileSync(resolve(APP_ROOT, 'Dockerfile'), 'utf8');
    const workerDockerfile = readFileSync(resolve(APP_ROOT, 'Dockerfile.worker'), 'utf8');

    const vendorIdx = dockerfile.indexOf('COPY vendor ./vendor');
    const installIdx = dockerfile.indexOf('RUN pnpm install --frozen-lockfile');
    expect(vendorIdx).toBeGreaterThan(-1);
    expect(vendorIdx).toBeLessThan(installIdx);

    const workerVendorIdx = workerDockerfile.indexOf('COPY vendor ./vendor');
    const workerInstallIdx = workerDockerfile.indexOf('RUN pnpm install --frozen-lockfile');
    expect(workerVendorIdx).toBeGreaterThan(-1);
    expect(workerVendorIdx).toBeLessThan(workerInstallIdx);
  });

  it('has app/public/robots.txt disallowing /share/ so Dockerfile COPY /app/public succeeds and T6 is satisfied', () => {
    const robotsPath = resolve(APP_ROOT, 'public/robots.txt');
    expect(existsSync(robotsPath)).toBe(true);
    const robots = readFileSync(robotsPath, 'utf8');
    expect(robots).toContain('Disallow: /share/');
  });

  it('has tsconfig.worker.json so pnpm worker:pdf:build succeeds', () => {
    const workerTsconfigPath = resolve(APP_ROOT, 'tsconfig.worker.json');
    expect(existsSync(workerTsconfigPath)).toBe(true);
  });

  it('documents POSTGRES_APP_USER and POSTGRES_APP_PASSWORD in .env.staging.example and app/docker-compose.yml', () => {
    const envStaging = readFileSync(resolve(REPO_ROOT, '.env.staging.example'), 'utf8');
    expect(envStaging).toContain('POSTGRES_APP_USER');
    expect(envStaging).toContain('POSTGRES_APP_PASSWORD');

    const appCompose = readFileSync(resolve(APP_ROOT, 'docker-compose.yml'), 'utf8');
    const postgresSection = appCompose.split('redis:')[0] ?? '';
    expect(postgresSection).toContain('POSTGRES_APP_USER');
    expect(postgresSection).toContain('POSTGRES_APP_PASSWORD');
  });

  it('passes DATABASE_READONLY_URL and RESEND_API_KEY to pdf-worker in root docker-compose.yml', () => {
    const rootCompose = readFileSync(resolve(REPO_ROOT, 'docker-compose.yml'), 'utf8');
    const workerPart =
      rootCompose.split('\n  pdf-worker:\n')[1]?.split('\n  postgres:\n')[0] ?? '';
    expect(workerPart).toContain('DATABASE_READONLY_URL');
    expect(workerPart).toContain('RESEND_API_KEY');
  });

  it('enforces 0 warnings in .github/workflows/ci.yml', () => {
    const ci = readFileSync(resolve(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).not.toContain('--max-warnings 100');
    expect(ci).toMatch(/pnpm lint:strict|--max-warnings 0/);
  });
});
