import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// tests/unit/scripts/*.test.ts → app/tests/unit/scripts → app → <repo>
const REPO_ROOT = resolve(__dirname, '../../../..');

const ENV_EXAMPLE = resolve(REPO_ROOT, '.env.staging.example');
const NGINX_CONF = resolve(REPO_ROOT, 'deploy/nginx/dash-bi.conf');
const CRON_FILE = resolve(REPO_ROOT, 'deploy/cron/dashbi-backup');

describe('deploy/ assets (operator drop-ins)', () => {
  describe('.env.staging.example', () => {
    let source: string;

    beforeAll(() => {
      if (!existsSync(ENV_EXAMPLE)) {
        throw new Error(
          `Missing required template: ${ENV_EXAMPLE}. Operators need a tracked file to copy and edit.`,
        );
      }
      source = readFileSync(ENV_EXAMPLE, 'utf8');
    });

    it('exists', () => {
      expect(existsSync(ENV_EXAMPLE)).toBe(true);
    });

    it('documents every secret the smoke-staging.sh + root compose enforce', () => {
      const required = [
        'POSTGRES_PASSWORD',
        'POSTGRES_READONLY_PASSWORD',
        'REDIS_PASSWORD',
        'LLM_KEY_ENCRYPTION_KEY',
        'BETTER_AUTH_SECRET',
        'PDF_WORKER_SECRET',
      ];
      for (const k of required) {
        expect(source).toContain(k);
      }
    });

    it('does NOT contain the known-insecure default values from the old README', () => {
      // Operators copy this verbatim into .env.staging. Any leakage of
      // the legacy `dashbi_password` / `redis_password` / hardcoded hex
      // would defeat the hardening we just did in docker-compose.yml.
      expect(source).not.toMatch(/dashbi_password/);
      expect(source).not.toMatch(/redis_password/);
      expect(source).not.toMatch(/0123456789abcdef0123456789abcdef/);
    });

    it('tells operators how to generate each secret (openssl one-liner)', () => {
      expect(source).toMatch(/openssl rand/);
    });

    it('has placeholder values that an operator will obviously need to replace', () => {
      // Either `__PASTE_*__` style or explicit `<replace-me>` markers.
      // Empty values would silently re-introduce the insecure-default
      // failure mode we are trying to prevent.
      expect(source).toMatch(/__(?:PASTE|GENERATED|REQUIRED)[A-Z_]*__/);
    });
  });

  describe('deploy/nginx/dash-bi.conf', () => {
    let source: string;

    beforeAll(() => {
      if (!existsSync(NGINX_CONF)) {
        throw new Error(
          `Missing required nginx site config: ${NGINX_CONF}. Operators need a drop-in file, not a heredoc to retype.`,
        );
      }
      source = readFileSync(NGINX_CONF, 'utf8');
    });

    it('exists', () => {
      expect(existsSync(NGINX_CONF)).toBe(true);
    });

    it('uses a placeholder server_name so it cannot accidentally enable on a wrong domain', () => {
      // Must not contain a real-looking domain like `dash-bi.com` or
      // `example.com` literally — the operator must substitute.
      expect(source).toMatch(/server_name\s+bi\.__[A-Z_]+__/);
      // And the cert paths must reference the same placeholder so an
      // operator who only does `sed` substitution can't end up with a
      // mismatched pair (server_name=real.com, cert_path=placeholder).
      expect(source).toMatch(/ssl_certificate\s+.*bi\.__[A-Z_]+__/);
      expect(source).not.toMatch(/server_name\s+bi\.dash-bi\.com/);
      expect(source).not.toMatch(/server_name\s+bi\.example\.com/);
    });

    it('redirects plain HTTP to HTTPS', () => {
      expect(source).toMatch(/listen\s+80/);
      expect(source).toMatch(/return\s+301\s+https/);
    });

    it('enables TLS 1.2+ and HSTS', () => {
      expect(source).toMatch(/ssl_protocols\s+TLSv1\.2\s+TLSv1\.3/);
      expect(source).toMatch(/Strict-Transport-Security/);
    });

    it('proxies to the app on localhost:3000', () => {
      expect(source).toMatch(/proxy_pass\s+http:\/\/localhost:3000/);
    });

    it('exposes no internal worker port publicly', () => {
      // The pdf-worker should never appear in proxy_pass.
      expect(source).not.toMatch(/proxy_pass\s+http:\/\/(localhost|127\.0\.0\.1):3001/);
      expect(source).not.toMatch(/proxy_pass\s+http:\/\/pdf-worker/);
    });
  });

  describe('deploy/cron/dashbi-backup', () => {
    let source: string;

    beforeAll(() => {
      if (!existsSync(CRON_FILE)) {
        throw new Error(
          `Missing required cron drop-in: ${CRON_FILE}. The daily backup must be a tracked file so CI / linters can review it.`,
        );
      }
      source = readFileSync(CRON_FILE, 'utf8');
    });

    it('exists', () => {
      expect(existsSync(CRON_FILE)).toBe(true);
    });

    it('uses a placeholder repo path so it cannot accidentally run from the wrong host checkout', () => {
      // Must reference the canonical script path and must not hardcode
      // a real-looking install path. The operator substitutes `__REPO_PATH__`.
      expect(source).toMatch(/__REPO_PATH__/);
      expect(source).toMatch(/scripts\/backup\.sh/);
    });

    it('runs as root (Postgres dump + filesystem writes need it)', () => {
      expect(source).toMatch(/^\s*\d+\s+\d+\s+\*\s+\*\s+\*\s+root\s+/m);
    });

    it('sources the staging env before invoking backup.sh', () => {
      // The cron line must `set -a; . ./.env.staging; set +a` (or
      // equivalent) so the script sees POSTGRES_PASSWORD etc.
      expect(source).toMatch(/\.\s+\.?\/?\.env\.staging/);
    });

    it('schedules daily (3 AM UTC)', () => {
      // The cron syntax is `m h dom mon dow user command`. We assert
      // hour=3, dom=*, mon=*, dow=* and that the minute is a number.
      expect(source).toMatch(/^\s*\d+\s+3\s+\*\s+\*\s+\*\s+root/m);
    });
  });
});