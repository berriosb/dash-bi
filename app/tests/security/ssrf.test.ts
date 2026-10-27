import { describe, it, expect } from 'vitest';
import { validatePostgresHost, SSRFError } from '@/lib/security/validate-connection';

/**
 * Every message the DB path throws carries "not allowed", so the message
 * shape is asserted alongside the error type.
 */
const REJECTED = /not allowed/i;

/**
 * Hosts that must never reach a socket.
 *
 * Each entry is a live bypass of a raw-string comparison: the alternate
 * `inet_aton` notations the resolver accepts, IPv6 loopback /
 * unique-local / link-local, port and userinfo suffixes, and the internal
 * service names reachable through the container network.
 */
const BLOCKED_HOSTS = [
  '127.0.0.1',
  '127.1',
  '2130706433',
  '0177.0.0.1',
  '0x7f.0.0.1',
  '[::1]',
  '::1',
  'fd00::1',
  'fe80::1',
  'localhost',
  'localhost:3000',
  '127.0.0.1:5432',
  '10.0.0.1',
  '172.16.0.1',
  '192.168.1.1',
  '169.254.169.254',
  'metadata.google.internal',
  'redis',
  'db.internal',
  'postgres',
  'user:pass@10.0.0.5',
  // The trailing dot of a fully qualified name: the resolver answers
  // "localhost." with the loopback address just the same.
  'localhost.',
  '127.0.0.1.',
  // IPv4-mapped IPv6 and the Debian spelling of the loopback name.
  '::ffff:127.0.0.1',
  'localhost.localdomain',
];

/**
 * Hosts that must stay reachable: public addresses and public names, plus
 * the single-label identifiers the Snowflake connector passes in (an
 * account name is legitimately a label with no dot).
 */
const ALLOWED_HOSTS = [
  '8.8.8.8',
  '1.1.1.1',
  'db.acme.com',
  'postgres.example.org',
  'rds.amazonaws.com',
  '2001:4860:4860::8888',
  'myaccount',
  'my-account',
];

describe('validatePostgresHost - SSRF prevention (T3)', () => {
  it('rejects localhost', () => {
    expect(() => validatePostgresHost('localhost')).toThrow();
  });

  it('rejects 127.0.0.1', () => {
    expect(() => validatePostgresHost('127.0.0.1')).toThrow();
  });

  it('rejects AWS metadata endpoint', () => {
    expect(() => validatePostgresHost('169.254.169.254')).toThrow();
  });

  it('rejects GCP metadata endpoint', () => {
    expect(() => validatePostgresHost('metadata.google.internal')).toThrow();
  });

  it('rejects RFC1918 10.x.x.x', () => {
    expect(() => validatePostgresHost('10.0.0.1')).toThrow();
    expect(() => validatePostgresHost('10.255.255.255')).toThrow();
  });

  it('rejects RFC1918 172.16-31.x.x', () => {
    expect(() => validatePostgresHost('172.16.0.1')).toThrow();
    expect(() => validatePostgresHost('172.20.0.1')).toThrow();
    expect(() => validatePostgresHost('172.31.255.255')).toThrow();
  });

  it('rejects RFC1918 192.168.x.x', () => {
    expect(() => validatePostgresHost('192.168.1.1')).toThrow();
  });

  it('allows public hostnames', () => {
    expect(() => validatePostgresHost('db.acme.com')).not.toThrow();
    expect(() => validatePostgresHost('postgres.example.org')).not.toThrow();
    expect(() => validatePostgresHost('rds.amazonaws.com')).not.toThrow();
  });

  it('allows public IPs', () => {
    expect(() => validatePostgresHost('8.8.8.8')).not.toThrow();
    expect(() => validatePostgresHost('1.1.1.1')).not.toThrow();
  });

  it('requires a host', () => {
    expect(() => validatePostgresHost('')).toThrow(SSRFError);
  });

  describe('normalizes the host before comparing it', () => {
    it.each(BLOCKED_HOSTS)('rejects %s', (host) => {
      expect(() => validatePostgresHost(host)).toThrow(SSRFError);
      expect(() => validatePostgresHost(host)).toThrow(REJECTED);
    });

    it.each(ALLOWED_HOSTS)('allows %s', (host) => {
      expect(() => validatePostgresHost(host)).not.toThrow();
    });
  });

  describe('normalizes without over-rejecting', () => {
    it('allows a public host with a port suffix', () => {
      expect(() => validatePostgresHost('db.acme.com:5432')).not.toThrow();
    });

    it('allows a public host in URL form', () => {
      expect(() => validatePostgresHost('postgres://user:pass@db.acme.com:5432/analytics')).not.toThrow();
    });

    it('allows a public host written as a fully qualified name', () => {
      expect(() => validatePostgresHost('db.acme.com.')).not.toThrow();
    });

    it('allows a Snowflake account identifier', () => {
      expect(() => validatePostgresHost('xy12345.us-east-1')).not.toThrow();
      expect(() => validatePostgresHost('myaccount')).not.toThrow();
      expect(() => validatePostgresHost('my-account')).not.toThrow();
    });

    it('allows a Shopify shop host', () => {
      expect(() => validatePostgresHost('my-shop.myshopify.com')).not.toThrow();
    });
  });

  describe('error contract', () => {
    it('throws an SSRFError instance, not a plain Error', () => {
      // The connectors and the API route branch on `err instanceof
      // SSRFError`; a generic Error would be rewrapped and lose the
      // dedicated code path.
      let caught: unknown;
      try {
        validatePostgresHost('127.1');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(SSRFError);
      expect((caught as Error).name).toBe('SSRFError');
    });

    it('rejects an internal service name with a "not allowed" message', () => {
      expect(() => validatePostgresHost('redis')).toThrow(REJECTED);
      expect(() => validatePostgresHost('db.internal')).toThrow(REJECTED);
    });
  });
});
