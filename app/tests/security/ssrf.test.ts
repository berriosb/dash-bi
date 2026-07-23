import { describe, it, expect } from 'vitest';
import { validatePostgresHost } from '@/lib/security/validate-connection';

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
});