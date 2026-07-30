import type { ArchetypeId } from './types';
import {
  ARCHETYPE_KEYWORDS,
  ARCHETYPE_LIST,
  ARCHETYPE_IDS,
  type ArchetypeTemplate,
} from './archetypes';

export type ConnectorType = 'postgres' | 'stripe' | 'sheets' | 'shopify' | 'meta-ads' | 'notion';

export type SelectorInput = {
  prompt: string;
  dataSourceType: ConnectorType;
  recentArchetypes?: ArchetypeId[];
};

export type SelectorResult = {
  archetype: ArchetypeId;
  reason: string;
  score: number;
  alternatives: Array<{ archetype: ArchetypeId; score: number }>;
};

const DOMAIN_HINTS: Record<ConnectorType, ArchetypeId[]> = {
  postgres: ['cohort-matrix', 'operations-live', 'kpi-grid'],
  stripe: ['finance-report', 'kpi-grid', 'growth-metrics'],
  sheets: ['executive-summary', 'kpi-grid'],
  shopify: ['growth-metrics', 'finance-report'],
  'meta-ads': ['growth-metrics', 'sales-pipeline'],
  notion: ['kpi-grid'],
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function scoreArchetype(
  archetype: ArchetypeTemplate,
  promptLower: string,
  dataSourceType: ConnectorType,
  recent: ArchetypeId[],
): number {
  let score = 0;

  for (const keyword of archetype.keywords) {
    const kw = normalize(keyword);
    if (kw.length === 0) continue;

    if (promptLower.includes(kw)) {
      score += 10;
    }
  }

  const domainHints = DOMAIN_HINTS[dataSourceType] ?? [];
  if (domainHints[0] === archetype.id) score += 5;
  else if (domainHints[1] === archetype.id) score += 3;
  else if (domainHints[2] === archetype.id) score += 1;

  if (recent.includes(archetype.id)) {
    const recentIndex = recent.indexOf(archetype.id);
    score -= Math.max(0, 6 - recentIndex * 2);
  }

  return score;
}

export function selectArchetype(input: SelectorInput): SelectorResult {
  const promptLower = normalize(input.prompt);
  const recent = input.recentArchetypes ?? [];

  const scored = ARCHETYPE_LIST
    .map(archetype => ({
      archetype: archetype as ArchetypeTemplate,
      score: scoreArchetype(archetype, promptLower, input.dataSourceType, recent),
    }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      archetype: 'kpi-grid',
      reason: 'Selector vacío — fallback al default',
      score: 0,
      alternatives: [],
    };
  }

  const keywordHits = scored.filter(s => s.score >= 10);

  if (keywordHits.length === 0) {
    return {
      archetype: 'kpi-grid',
      reason: 'Sin keywords matchados — fallback al default "kpi-grid"',
      score: 0,
      alternatives: scored.slice(1, 4).map(s => ({
        archetype: s.archetype.id,
        score: s.score,
      })),
    };
  }

  const winner = keywordHits[0]!;
  const alternatives = scored.slice(1, 4).map(s => ({
    archetype: s.archetype.id,
    score: s.score,
  }));

  const winnerArchetypeId = winner.archetype.id as keyof typeof ARCHETYPE_KEYWORDS;
  const keywordsList = ARCHETYPE_KEYWORDS[winnerArchetypeId] ?? [];
  const matchedKeywords = keywordsList.filter((k: string) =>
    promptLower.includes(normalize(k)),
  );

  return {
    archetype: winner.archetype.id,
    reason: `Elegido "${winner.archetype.name}" por keywords: ${matchedKeywords.join(', ')}`,
    score: winner.score,
    alternatives,
  };
}

export function suggestVariations(input: SelectorInput, count = 3): ArchetypeId[] {
  const recent = input.recentArchetypes ?? [];

  const scored = ARCHETYPE_LIST.map(archetype => ({
    archetype: archetype as ArchetypeTemplate,
    score: scoreArchetype(archetype, normalize(input.prompt), input.dataSourceType, recent),
  }));

  scored.sort((a, b) => {
    const recentA = recent.indexOf(a.archetype.id);
    const recentB = recent.indexOf(b.archetype.id);
    const recentPenaltyA = recentA === -1 ? 0 : 100 - recentA * 25;
    const recentPenaltyB = recentB === -1 ? 0 : 100 - recentB * 25;

    const adjustedA = a.score - recentPenaltyA;
    const adjustedB = b.score - recentPenaltyB;

    return adjustedB - adjustedA;
  });

  const seen = new Set<ArchetypeId>();
  const result: ArchetypeId[] = [];

  for (const { archetype } of scored) {
    if (seen.has(archetype.id) || result.includes(archetype.id)) continue;
    seen.add(archetype.id);
    result.push(archetype.id);
    if (result.length >= count) break;
  }

  while (result.length < count) {
    const fallback: ArchetypeId = 'kpi-grid';
    if (result.includes(fallback)) break;
    result.push(fallback);
  }

  return result;
}

export function detectKeywords(prompt: string): string[] {
  const promptLower = normalize(prompt);
  const found: string[] = [];

  for (const id of ARCHETYPE_IDS) {
    for (const keyword of ARCHETYPE_KEYWORDS[id]) {
      if (promptLower.includes(normalize(keyword))) {
        found.push(keyword);
      }
    }
  }

  return found;
}

export type { ArchetypeTemplate };
