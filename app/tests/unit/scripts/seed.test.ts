import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockEnd = vi.fn().mockResolvedValue(undefined);

const mockDb = {
  insert: mockInsert,
  select: mockSelect,
};

vi.mock('postgres', () => ({
  default: vi.fn(() => ({
    end: mockEnd,
  })),
}));

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: vi.fn(() => mockDb),
}));

vi.mock('@/lib/security/encryption', () => ({
  encryptApiKey: vi.fn(() => 'encrypted_mock_config'),
}));

import { seedDatabase, DEMO_IDS } from '@/../scripts/seed';

describe('Database Seed Script', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const chainInsert = {
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue([]),
        onConflictDoNothing: vi.fn().mockResolvedValue([]),
      }),
    };
    mockInsert.mockReturnValue(chainInsert);

    const chainSelect = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]), // No member yet
      }),
    };
    mockSelect.mockReturnValue(chainSelect);
  });

  it('connects to postgres and inserts demo entities', async () => {
    await seedDatabase('postgres://test:test@localhost:5432/test');

    expect(mockInsert).toHaveBeenCalledTimes(6); // org, user, member, dataSource, dashboard, version
    expect(mockEnd).toHaveBeenCalledOnce();
  });

  it('exports stable demo IDs', () => {
    expect(DEMO_IDS.orgId).toBe('00000000-0000-4000-a000-000000000001');
    expect(DEMO_IDS.userId).toBe('00000000-0000-4000-a000-000000000002');
  });
});
