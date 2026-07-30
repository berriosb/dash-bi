/**
 * Type inference for CSV/Excel columns.
 *
 * Strategy: sample the first N non-null values, count the inferred type
 * for each, and pick the majority if it's >= 80% of the sample. If
 * ambiguous, fall back to 'string' to avoid silently coercing the wrong
 * type at SQL load time.
 */
export type InferredType = 'number' | 'date' | 'boolean' | 'string' | 'json';

const SAMPLE_SIZE = 500;
const MAJORITY_THRESHOLD = 0.8;

const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const BOOLEAN_RE = /^(true|false|yes|no)$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T?\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const COMMON_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

export function detectType(value: unknown): InferredType {
  if (value === null || value === undefined || value === '') return 'string';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? 'number' : 'string';
  }
  if (typeof value === 'boolean') return 'boolean';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'string' : 'date';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (NUMBER_RE.test(trimmed)) return 'number';
    if (BOOLEAN_RE.test(trimmed)) return 'boolean';
    if (ISO_DATE_RE.test(trimmed) || COMMON_DATE_RE.test(trimmed)) {
      return 'date';
    }
  }
  return 'string';
}

export interface InferredColumn {
  name: string;
  type: InferredType;
  nullable: boolean;
  samples: unknown[];
}

export function inferColumns(
  rows: Array<Record<string, unknown>>,
): InferredColumn[] {
  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0] ?? {});
  const sampleSize = Math.min(rows.length, SAMPLE_SIZE);
  const sample = rows.slice(0, sampleSize);

  return headers.map((header) => {
    const values = sample
      .map((r) => r[header])
      .filter((v) => v !== null && v !== undefined && v !== '');

    const counts: Record<InferredType, number> = {
      number: 0,
      date: 0,
      boolean: 0,
      string: 0,
      json: 0,
    };
    for (const v of values) counts[detectType(v)]++;

    const total = values.length;
    const winner = (Object.entries(counts) as [InferredType, number][])
      .sort((a, b) => b[1] - a[1])[0]!;
    const winnerPct = total === 0 ? 0 : winner[1] / total;
    const type: InferredType =
      winnerPct >= MAJORITY_THRESHOLD && winner[1] > 0
        ? winner[0]
        : 'string';

    return {
      name: header,
      type,
      nullable: values.length < sampleSize,
      samples: values.slice(0, 5),
    };
  });
}