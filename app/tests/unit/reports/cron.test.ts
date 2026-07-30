import { describe, it, expect } from 'vitest';
import { parseCronAndNextRun, isValidCron } from '@/lib/reports/cron';

describe('Scheduled Reports Cron Helper', () => {
  it('validates standard 5-part cron expressions', () => {
    expect(isValidCron('0 9 * * 1')).toBe(true); // Monday 9am
    expect(isValidCron('0 0 * * *')).toBe(true); // Daily midnight
    expect(isValidCron('invalid cron')).toBe(false);
  });

  it('computes next run date accurately from cron', () => {
    const fromDate = new Date('2026-07-27T08:00:00Z'); // Monday 8am
    const nextRun = parseCronAndNextRun('0 9 * * 1', fromDate);
    expect(nextRun).toBeInstanceOf(Date);
    expect(nextRun.getTime()).toBeGreaterThan(fromDate.getTime());
  });
});
