/**
 * Sprint 1.5: in-memory bridge for the /upload → /commit two-phase
 * flow. Stores the parsed rows + format under the fileId so the
 * commit endpoint can re-insert them without re-uploading the file.
 *
 * Dev-only: production should use Redis or a temp file path. The
 * Map is process-local, so it resets on server restart — Fase 2
 * will move to a durable backend.
 */
export type StoredParse = {
  rows: Array<Record<string, unknown>>;
  format: 'csv' | 'xlsx' | 'xls';
};

const parseStore: Map<string, StoredParse> = new Map();

export function storeParsedForCommit(
  fileId: string,
  rows: Array<Record<string, unknown>>,
  format: 'csv' | 'xlsx' | 'xls',
): void {
  parseStore.set(fileId, { rows, format });
}

export function takeParsedForCommit(fileId: string): StoredParse | undefined {
  const stored = parseStore.get(fileId);
  if (stored) parseStore.delete(fileId);
  return stored;
}

export function peekParsedForCommit(fileId: string): StoredParse | undefined {
  return parseStore.get(fileId);
}