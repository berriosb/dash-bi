import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { getTestDb, resetDb, closeTestDb, testDbUri, type TestDb } from './postgres';
import { schemaRef } from './postgres';

/**
 * The budget gate was a CHECK, and a check is not a gate.
 *
 * It read the month's spend, compared it with the cap, and returned. The
 * spend was recorded AFTER the model call, so N calls that started at the
 * same time all read the SAME spend, all passed, and all spent. The gap
 * between the check and the record was the whole burst.
 *
 * The ledger closes it: a call RESERVES its estimated cost before it
 * starts, and the reservation is part of what the next caller sees. The
 * check and the reservation have to be one atomic step, which is what the
 * advisory lock per org is for.
 *
 * The budget here is deliberately tiny ($0.25) and the calls are
 * concurrent, so the test asserts an exact number of reservations: the
 * ones that fit and not one more.
 */
const RUNTIME_UNAVAILABLE = /container runtime|Could not find a working container runtime/i;

const ORG_ID = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const USER_ID = 'bbbbbbbb-0000-0000-0000-0000000000bb';

/** The budget for this test, in dollars. */
const BUDGET_USD = 0.25;

describe('ledger de presupuesto de LLM', () => {
  let db: TestDb;
  let runtimeAvailable = false;

  beforeAll(async () => {
    try {
      db = await getTestDb();
      // The app's DB client (`@/db/client`) reads DATABASE_URL when the
      // module loads, and the ledger goes through it. Point it at the
      // container and reset the module registry so the next import picks
      // the new value up.
      process.env.DATABASE_URL = testDbUri();
      vi.resetModules();
      runtimeAvailable = true;
    } catch (error) {
      if (RUNTIME_UNAVAILABLE.test(String(error))) {
        if (process.env.RLS_TESTS_REQUIRED === '1') throw error;
        console.warn('[integration] skipped: no container runtime for Postgres');
        return;
      }
      throw error;
    }
  }, 120_000);

  beforeEach(async () => {
    if (!runtimeAvailable) return;
    await resetDb();
  }, 60_000);

  afterAll(async () => {
    if (runtimeAvailable) {
      // The app's own pool, opened by the ledger. Closing it keeps vitest
      // from reporting an open handle.
      const { db: appDb } = await import('@/db/client');
      await appDb.$client.end({ timeout: 5 });
    }
    if (db) await closeTestDb();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function itWithDb(name: string, fn: () => Promise<void>): void {
    it(name, async (ctx) => {
      if (!runtimeAvailable || !db) {
        ctx.skip();
        return;
      }
      await fn();
    });
  }

  async function seedOrg(): Promise<void> {
    const { users, orgs } = schemaRef();
    await db.insert(users).values({ id: USER_ID, email: 'llm@test.invalid', name: 'LLM' });
    await db.insert(orgs).values({ id: ORG_ID, name: 'Org', slug: 'llm-org' });
  }

  /** How many reservations fit under the cap, with the same rule the gate uses. */
  function reservationsThatFit(reserveUsd: number): number {
    // The gate refuses when the committed total REACHES the budget, so the
    // count is the number of reservations that stay strictly below it.
    // Integer cents, because the database compares exact decimals and the
    // test must not disagree with it over a float.
    const reserveCents = Math.round(reserveUsd * 10000);
    const budgetCents = Math.round(BUDGET_USD * 10000);

    let committed = 0;
    let count = 0;
    while (committed + reserveCents < budgetCents) {
      committed += reserveCents;
      count += 1;
    }
    return count;
  }

  itWithDb('N reservas concurrentes: solo pasan las que caben en el presupuesto', async () => {
    await seedOrg();
    vi.stubEnv('LLM_BUDGET_FREE_USD', String(BUDGET_USD));

    const { estimateReservationUsd, reserveLlmBudget } = await import('@/lib/ai/budget-ledger');
    const { LLMBudgetExceededError } = await import('@/lib/ai/quota');

    const reserveUsd = estimateReservationUsd('gpt-4o');
    const expected = reservationsThatFit(reserveUsd);
    expect(expected).toBeGreaterThan(0);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        reserveLlmBudget({
          orgId: ORG_ID,
          userId: USER_ID,
          plan: 'free',
          provider: 'openai',
          model: 'gpt-4o',
        }),
      ),
    );

    const passed = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected');

    // ESTE es el BURST: sin el ledger, las 10 llamadas concurrentes leen
    // el mismo gasto, las 10 pasan y las 10 gastan.
    expect(passed).toHaveLength(expected);
    expect(refused).toHaveLength(10 - expected);

    for (const rejection of refused) {
      expect((rejection as PromiseRejectedResult).reason).toBeInstanceOf(
        LLMBudgetExceededError,
      );
    }
  });

  itWithDb('la reserva queda pendiente mientras la llamada está en vuelo y se liquida con el gasto real', async () => {
    await seedOrg();
    vi.stubEnv('LLM_BUDGET_FREE_USD', String(BUDGET_USD));

    const { reserveLlmBudget } = await import('@/lib/ai/budget-ledger');
    const { llmUsage, llmBudgetReservations } = schemaRef();

    const reservation = await reserveLlmBudget({
      orgId: ORG_ID,
      userId: USER_ID,
      plan: 'free',
      provider: 'openai',
      model: 'gpt-4o',
    });

    const [pending] = await db.select().from(llmBudgetReservations);
    expect(pending?.status).toBe('pending');
    expect(pending?.settledUsd).toBeNull();
    expect(Number(pending?.reservedUsd)).toBeGreaterThan(0);
    expect(await db.select().from(llmUsage)).toHaveLength(0);

    await reservation.settle(
      { promptTokens: 100, completionTokens: 50 },
      { latencyMs: 42, success: true },
    );

    const [settled] = await db.select().from(llmBudgetReservations);
    expect(settled?.status).toBe('settled');
    expect(Number(settled?.settledUsd)).toBeGreaterThan(0);
    expect(settled?.settledAt).not.toBeNull();

    // Y el gasto real queda en `llm_usage`, una sola vez.
    const usage = await db.select().from(llmUsage);
    expect(usage).toHaveLength(1);
    expect(usage[0]?.promptTokens).toBe(100);
    expect(usage[0]?.completionTokens).toBe(50);
  });

  itWithDb('el gasto ya liquidado cuenta contra el presupuesto', async () => {
    await seedOrg();
    vi.stubEnv('LLM_BUDGET_FREE_USD', String(BUDGET_USD));

    const { estimateReservationUsd, reserveLlmBudget } = await import('@/lib/ai/budget-ledger');
    const { llmUsage } = schemaRef();

    const reserveUsd = estimateReservationUsd('gpt-4o');

    // Un gasto liquidado que se lleva casi todo el presupuesto.
    await db.insert(llmUsage).values({
      orgId: ORG_ID,
      userId: USER_ID,
      provider: 'openai',
      model: 'gpt-4o',
      promptTokens: 1000,
      completionTokens: 1000,
      costUsd: String(BUDGET_USD - reserveUsd / 2),
      success: true,
    });

    await expect(
      reserveLlmBudget({
        orgId: ORG_ID,
        userId: USER_ID,
        plan: 'free',
        provider: 'openai',
        model: 'gpt-4o',
      }),
    ).rejects.toThrow(/budget/i);
  });

  itWithDb('un plan sin límite no reserva nada', async () => {
    await seedOrg();
    vi.stubEnv('LLM_BUDGET_ENTERPRISE_USD', '0');

    const { reserveLlmBudget } = await import('@/lib/ai/budget-ledger');
    const { llmBudgetReservations } = schemaRef();

    const reservation = await reserveLlmBudget({
      orgId: ORG_ID,
      userId: USER_ID,
      plan: 'enterprise',
      provider: 'openai',
      model: 'gpt-4o',
    });

    // Sin límite no hay nada que reservar: la fila sería ruido.
    expect(await db.select().from(llmBudgetReservations)).toHaveLength(0);
    await expect(
      reservation.settle({ promptTokens: 1, completionTokens: 1 }, { success: true }),
    ).resolves.toBeUndefined();
  });

  itWithDb('la reserva respeta el aislamiento por org', async () => {
    await seedOrg();
    vi.stubEnv('LLM_BUDGET_FREE_USD', String(BUDGET_USD));

    const { reserveLlmBudget } = await import('@/lib/ai/budget-ledger');
    const { llmBudgetReservations } = schemaRef();

    await reserveLlmBudget({
      orgId: ORG_ID,
      userId: USER_ID,
      plan: 'free',
      provider: 'openai',
      model: 'gpt-4o',
    });

    // La reserva es de una org: otra org no la ve.
    const visible = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE dashbi`);
      await tx.execute(
        sql`SELECT set_config('app.current_org_id', 'cccccccc-0000-0000-0000-0000000000cc', true)`,
      );
      return tx.select().from(llmBudgetReservations);
    });

    expect(visible).toHaveLength(0);
  });
});
