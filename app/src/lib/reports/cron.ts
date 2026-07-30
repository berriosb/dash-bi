/**
 * Cron helper for scheduled reports.
 * Validates standard 5-field cron strings and calculates the next execution time.
 */

export function isValidCron(cron: string): boolean {
  if (!cron || typeof cron !== 'string') return false;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  // Basic regex check for standard 5-part cron tokens (*, numbers, ranges, steps, lists)
  const cronPartRegex = /^(\*|\d+(-\d+)?(\/\d+)?(,\d+(-\d+)?(\/\d+)?)*)$/;
  return parts.every(part => cronPartRegex.test(part));
}

export function parseCronAndNextRun(cron: string, fromDate = new Date()): Date {
  if (!isValidCron(cron)) {
    throw new Error(`Expresión cron inválida: ${cron}`);
  }

  // Calculate next run date (defaulting to +1 day / +1 week based on cron pattern or 24h fallback)
  const next = new Date(fromDate.getTime());

  // Handle common intervals cleanly
  const parts = cron.trim().split(/\s+/);
  const minute = parts[0] ?? '*';
  const hour = parts[1] ?? '*';
  const dow = parts[4] ?? '*';

  const targetMin = minute === '*' ? 0 : parseInt(minute, 10) || 0;
  const targetHour = hour === '*' ? 9 : parseInt(hour, 10) || 9;

  next.setHours(targetHour, targetMin, 0, 0);

  // If next run calculation is in the past, add 1 day until future
  if (next.getTime() <= fromDate.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  // Handle day of week if specified (0-6 or 1-7)
  if (dow !== '*') {
    const targetDow = parseInt(dow, 10) % 7;
    while (next.getDay() !== targetDow || next.getTime() <= fromDate.getTime()) {
      next.setDate(next.getDate() + 1);
    }
  }

  return next;
}
