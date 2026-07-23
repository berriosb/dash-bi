# Spec: Testing Strategy

> Estrategia de testing consolidada. Define la matriz de tests, coverage targets, y gates de CI obligatorios. Cierra el gap **CRITICAL** marcado por `docs/audits/2026-07-21-arquitectura/STACK-AUDIT.md` §A10.

**Status:** Draft v0.1
**Prioridad:** P0 — bloquea implementación (validación sin tests = teatro)
**Responsable:** codehak
**Depende de:** todas las features (testing es transversal)

---

## Cambios respecto a v0.1

> Primera versión. Cierra gap del audit.

---

## 1. Objetivo

Garantizar que dash-bi funcione correctamente **sin依赖于 confianza manual**:

1. **Tests automatizados** que se corren en cada PR
2. **Coverage mínimo** en código crítico (security, multi-tenant, query engine)
3. **Tests de seguridad P0** ejecutándose en CI (no opcionales)
4. **Mocks deterministas** para LLMs (no se gastan tokens en CI)
5. **Contract tests** entre conectores y query-engine

---

## 2. Stack de testing

| Capa | Herramienta | Razón |
|------|-------------|-------|
| **Unit tests** | **Vitest** | Rápido, ESM nativo, compatible con Next 16 / TypeScript strict |
| **Integration tests** | **Vitest + Testcontainers** | Levanta Postgres real (no SQLite) en Docker para tests de RLS |
| **E2E tests** | **Playwright** | Multi-browser, soporta auth flows, iframe, drag-drop |
| **Property / fuzz tests** | **fast-check** | Genera inputs aleatorios para Zod schemas + SQL validation |
| **Coverage** | **Vitest v8 coverage** (built-in) + **Codecov** para trend |
| **LLM mocks** | **MSW** (Mock Service Worker) + fixtures grabadas | Intercepta llamadas a providers reales en CI |

**Versiones pinneadas** (ver `package.json`):

```json
{
  "devDependencies": {
    "vitest": "^2.1.0",
    "@vitest/coverage-v8": "^2.1.0",
    "@playwright/test": "^1.48.0",
    "testcontainers": "^10.13.0",
    "testcontainers-postgres": "^10.13.0",
    "fast-check": "^3.22.0",
    "msw": "^2.6.0",
    "@faker-js/faker": "^9.0.0"
  }
}
```

---

## 3. Matriz de tests por capa

### 3.1 Unit tests (Vitest)

**Dónde:** `tests/unit/**/*.test.ts` (co-locado con el código o en carpeta separada)
**Velocidad objetivo:** <500ms por archivo, suite completa <30s

**Categorías:**

| Categoría | Cobertura objetivo | Ejemplos |
|-----------|-------------------|----------|
| Schemas Zod | 100% (todas las validaciones) | `lib/widgets/schemas.test.ts`, `lib/security/validate-query.test.ts` |
| Funciones puras | 100% | `lib/query-engine/cache.ts`, `lib/themes/apply.ts`, `lib/demo/distributions.ts` |
| Helpers | >80% | `lib/auth/permissions.ts`, `lib/redact.ts`, `lib/encryption.ts` |
| Componentes (lógica) | >50% | `components/dashboard/PropertyPanel/*.test.tsx` |
| Componentes (visual) | E2E only (Playwright) | — |

**Convenciones:**

```typescript
// Estructura estándar
describe('WidgetSchema', () => {
  describe('KPIWidget', () => {
    it('accepts valid widget', () => {});
    it('rejects invalid position (col > 12)', () => {});
    it('rejects missing source', () => {});
    it('defaults showDelta to true', () => {});
  });
});
```

### 3.2 Integration tests (Vitest + Testcontainers)

**Dónde:** `tests/integration/**/*.test.ts`
**Velocidad objetivo:** <5s por archivo (Postgres Docker ya levantado)

**Categorías P0:**

```typescript
// tests/integration/security/tenant-isolation.test.ts
describe('Tenant isolation (T1 del threat-model.md)', () => {
  it('Org A cannot read Org B dashboards', ...);
  it('Org A cannot read Org B data sources', ...);
  it('Org A cannot read Org B queries', ...);
  it('Org A cannot read Org B llm_usage', ...);
  it('Org A cannot read Org B audit_log', ...);
  it('Org A cannot read Org B nlqa_conversations', ...);
  it('Org A cannot read Org B uploaded_files', ...);
  it('RLS is enforced even when withOrgContext is forgotten (must fail loud)', ...);
  it('Public link from Org A cannot be guessed/brute-forced', ...);
});

// tests/integration/security/sql-injection.test.ts
describe('SQL injection prevention (T2)', () => {
  it('rejects DROP TABLE', ...);
  it('rejects stacked queries', ...);
  it('rejects comments-based injection', ...);
  it('rejects UNION-based exfiltration', ...);
  it('auto-injects LIMIT if missing', ...);
  it('validates SQL via DB user permissions (SELECT only)', ...);
  it('rejects system tables (pg_*, information_schema)', ...);
});

// tests/integration/security/ssrf.test.ts
describe('SSRF prevention (T3)', () => {
  it('rejects localhost as Postgres host', ...);
  it('rejects 127.0.0.1', ...);
  it('rejects AWS metadata endpoint 169.254.169.254', ...);
  it('rejects RFC1918 private IPs', ...);
  it('rejects IPv6 loopback ::1', ...);
});

// tests/integration/security/byok.test.ts
describe('BYOK security (T4)', () => {
  it('keys are encrypted at rest (no plaintext in DB)', ...);
  it('keys never appear in logs', ...);
  it('keys never appear in API responses', ...);
  it('key rotation works without downtime', ...);
  it('master key rotation re-encrypts all keys', ...);
});

// tests/integration/security/rate-limit.test.ts
describe('Rate limit (T5)', () => {
  it('hourly generation limit enforced', ...);
  it('daily token limit enforced', ...);
  it('circuit breaker triggers on high cost', ...);
  it('NLQA quota enforced per user', ...);
  it('public link rate limit per IP', ...);
});
```

**Otras categorías:**

- Query engine end-to-end (con Postgres real)
- Connector implementations (Stripe/Sheets con `nock`)
- Cache (Redis + fallback a memoria)
- Multi-LLM router (con MSW interceptando providers)

### 3.3 E2E tests (Playwright)

**Dónde:** `tests/e2e/**/*.spec.ts`
**Velocidad objetivo:** suite crítica <5 min, suite completa <15 min

**Suite crítica (must-pass en CI):**

```typescript
// tests/e2e/auth.spec.ts
test.describe('Auth flow', () => {
  test('signup → email verification → first login', async ({ page }) => {});
  test('magic link login works end-to-end', async ({ page }) => {});
  test('Google OAuth login works', async ({ page }) => {});
  test('logout clears session', async ({ page }) => {});
  test('rate limit kicks in after 5 failed logins', async ({ page }) => {});
});

// tests/e2e/dashboard-lifecycle.spec.ts
test.describe('Dashboard lifecycle (the main flow)', () => {
  test('user creates org, connects data source, generates dashboard', async ({ page }) => {});
  test('user edits dashboard with drag-drop', async ({ page }) => {});
  test('user exports dashboard to PDF', async ({ page }) => {});
  test('user shares dashboard via public link, recipient can view', async ({ page }) => {});
  test('cross-tenant: org B cannot access org A dashboard URL (404)', async ({ page }) => {});
});

// tests/e2e/nlqa.spec.ts
test.describe('Natural language Q&A', () => {
  test('user asks question, gets answer + chart', async ({ page }) => {});
  test('user saves NLQA answer as widget in dashboard', async ({ page }) => {});
  test('streaming events visible (thinking → SQL → result → answer)', async ({ page }) => {});
});

// tests/e2e/demo-mode.spec.ts
test.describe('Demo mode', () => {
  test('user picks persona, sees demo dashboard in <60s', async ({ page }) => {});
  test('user deletes demo, data is cleaned up', async ({ page }) => {});
});

// tests/e2e/security.spec.ts
test.describe('Security (smoke tests en browser)', () => {
  test('unauthenticated user is redirected to /login', async ({ page }) => {});
  test('viewer cannot enter edit mode', async ({ page }) => {});
  test('public link does not expose edit controls', async ({ page }) => {});
  test('CSP headers block inline scripts', async ({ page }) => {});
});
```

### 3.4 Property / fuzz tests (fast-check)

**Dónde:** `tests/property/**/*.test.ts`
**Velocidad objetivo:** <10s por archivo

```typescript
// tests/property/widget-schema.test.ts
import fc from 'fast-check';

describe('WidgetSchema property tests', () => {
  it('any valid Widget passes Zod validation', () => {
    fc.assert(fc.property(widgetArbitrary, (widget) => {
      return WidgetSchema.safeParse(widget).success;
    }));
  });

  it('any random object either passes or fails with a typed error', () => {
    fc.assert(fc.property(fc.anything(), (input) => {
      const result = WidgetSchema.safeParse(input);
      return result.success || typeof result.error === 'object';
    }));
  });
});

// tests/property/sql-validation.test.ts
describe('SQL validation property tests', () => {
  it('never accepts DML/DDL regardless of casing', () => {
    fc.assert(fc.property(
      fc.constantFrom('DROP', 'drop', 'Drop', 'DrOp'),
      fc.string({ minLength: 1, maxLength: 50 }),
      (keyword, suffix) => {
        expect(() => validateQuery({ kind: 'sql', sql: `${keyword} TABLE ${suffix}` }, 'postgres'))
          .toThrow(ValidationError);
      }
    ));
  });
});
```

### 3.5 Contract tests (entre módulos)

**Dónde:** `tests/contract/**/*.test.ts`

```typescript
// tests/contract/connector-query-engine.test.ts
describe('Connector ↔ Query Engine contract', () => {
  it('every connector implements the Connector interface', () => {
    const connectors = [PostgresConnector, StripeConnector, SheetsConnector, SpreadsheetConnector];
    for (const Ctor of connectors) {
      const instance = new Ctor(mockConfig);
      expect(typeof instance.testConnection).toBe('function');
      expect(typeof instance.getSchema).toBe('function');
      expect(typeof instance.executeQuery).toBe('function');
    }
  });

  it('every query result has the expected shape', async () => {
    // ...
  });
});
```

---

## 4. Mocks y fixtures

### 4.1 LLM mocks (MSW)

```typescript
// tests/mocks/llm.ts
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const openAIMock = http.post('https://api.openai.com/v1/chat/completions', () => {
  return HttpResponse.json({
    choices: [{ message: { content: JSON.stringify(mockDashboardResponse) } }],
    usage: { prompt_tokens: 1500, completion_tokens: 500 },
  });
});

export const anthropicMock = http.post('https://api.anthropic.com/v1/messages', () => {
  return HttpResponse.json({
    content: [{ text: JSON.stringify(mockDashboardResponse) }],
    usage: { input_tokens: 1500, output_tokens: 500 },
  });
});

export const llmMockServer = setupServer(openAIMock, anthropicMock);
```

### 4.2 Connector mocks (nock)

```typescript
// tests/mocks/stripe.ts
import nock from 'nock';

export function mockStripeListCharges(charges: Stripe.Charge[]) {
  return nock('https://api.stripe.com')
    .get('/v1/charges')
    .reply(200, { data: charges, has_more: false });
}
```

### 4.3 Test data factories (faker)

```typescript
// tests/factories/org.ts
import { faker } from '@faker-js/faker';

export function createOrgFixture(overrides?: Partial<Org>): Org {
  return {
    id: faker.string.uuid(),
    name: faker.company.name(),
    slug: faker.helpers.slugify(faker.company.name()).toLowerCase(),
    plan: 'free',
    llmProvider: 'openai',
    llmModel: 'gpt-4o',
    createdAt: new Date(),
    ...overrides,
  };
}

// tests/factories/dashboard.ts
export function createDashboardFixture(overrides?: Partial<Dashboard>): Dashboard {
  return {
    title: faker.commerce.productName(),
    theme: 'moderno-saas',
    archetype: 'kpi-grid',
    widgets: [createKpiWidgetFixture()],
    ...overrides,
  };
}
```

### 4.4 Grabación de respuestas LLM (golden files)

Para tests de regresión más realistas, se graban respuestas reales y se commitean como JSON:

```
tests/fixtures/llm-responses/
  openai-gpt4o-dashboard-finance.json
  anthropic-claude35-dashboard-growth.json
  gemini-15pro-dashboard-empty.json
```

```typescript
// tests/fixtures/llm-responses/openai-gpt4o-dashboard-finance.json
{
  "request": { "prompt": "Generate a finance dashboard", "system": "..." },
  "response": {
    "object": { "title": "P&L Q3", "widgets": [...] },
    "usage": { "prompt_tokens": 1487, "completion_tokens": 612 }
  }
}
```

```typescript
// Uso en test
const fixture = readFixture('openai-gpt4o-dashboard-finance.json');
nock('https://api.openai.com').post('/v1/chat/completions').reply(200, fixture.response);
```

---

## 5. Configuración

### 5.1 `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['lib/**', 'components/**'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/types.ts'],
      thresholds: {
        'lib/security/**': { lines: 90, functions: 90, branches: 85 },
        'lib/query-engine/**': { lines: 80, functions: 80, branches: 75 },
        'lib/db/**': { lines: 80, functions: 80, branches: 75 },
        'lib/connectors/**': { lines: 75, functions: 75 },
        'components/**': { lines: 50, functions: 50 },
      },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './') },
  },
});
```

### 5.2 `playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
  webServer: process.env.CI ? {
    command: 'docker compose up -d && pnpm wait-on http://localhost:3000',
    url: 'http://localhost:3000',
    timeout: 120_000,
    reuseExistingServer: false,
  } : undefined,
});
```

### 5.3 Testcontainers setup

```typescript
// tests/setup.ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'child_process';

let pgContainer: StartedPostgreSqlContainer;

export async function setup() {
  pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('dashbi_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  process.env.DATABASE_URL = pgContainer.getConnectionUri();
  execSync('pnpm drizzle-kit push', { env: process.env });

  // Cargar RLS policies desde migrations
  execSync(`psql ${pgContainer.getConnectionUri()} -f tests/fixtures/rls-policies.sql`);
}

export async function teardown() {
  await pgContainer.stop();
}
```

---

## 6. CI gates (GitHub Actions)

**Pipeline:**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
  push: { branches: [main] }

jobs:
  lint:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck

  unit:
    needs: lint
    steps:
      - run: pnpm test:unit --coverage
      - uses: codecov/codecov-action@v4

  integration:
    needs: lint
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_PASSWORD: test }
    steps:
      - run: pnpm test:integration

  e2e:
    needs: [unit, integration]
    steps:
      - run: docker compose -f docker-compose.test.yml up -d
      - run: pnpm test:e2e
      - run: docker compose -f docker-compose.test.yml down

  security:
    needs: lint
    steps:
      - run: pnpm test:security  # subset de integration con naming convention
      - run: pnpm audit --prod
      - run: npx osv-scanner --lockfile=pnpm-lock.yaml

  build:
    needs: [unit, integration, security]
    steps:
      - run: pnpm build
      - run: docker build -t dashbi:test .
```

**Gates (PR no mergea si falla):**

- ✅ Lint pasa (ESLint + Prettier)
- ✅ Typecheck pasa (`tsc --noEmit`)
- ✅ Unit tests pasan
- ✅ Integration tests pasan (incluyendo security P0)
- ✅ E2E tests pasan en chromium + firefox
- ✅ Coverage de `lib/security/**` ≥90%
- ✅ Coverage de `lib/query-engine/**` ≥80%
- ✅ `pnpm audit` no muestra vulnerabilidades HIGH/CRITICAL
- ✅ Docker image builds sin errores

---

## 7. Convenciones de naming

- **Unit:** `*.test.ts` (co-localizado o en `tests/unit/`)
- **Integration:** `*.test.ts` en `tests/integration/`
- **E2E:** `*.spec.ts` en `tests/e2e/`
- **Property:** `*.prop.test.ts` en `tests/property/`
- **Security tests:** `*.security.test.ts` en `tests/integration/security/` (auto-collected por `pnpm test:security`)

---

## 8. Comandos npm

```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run tests/unit tests/property",
    "test:integration": "vitest run tests/integration",
    "test:security": "vitest run tests/integration/security",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest watch"
  }
}
```

---

## 9. Acceptance criteria

- [ ] CI corre lint + typecheck + unit + integration + security + e2e + build en cada PR
- [ ] Tests de tenant isolation cubren las 8 tablas tenant-scoped (incluyendo `nlqa_conversations`, `uploaded_files`, `demo_*`)
- [ ] Tests de SQL injection cubren DML/DDL/stacked/comment/UNION/system-tables
- [ ] Tests de SSRF cubren localhost/RFC1918/IPv6 loopback/AWS metadata
- [ ] Tests de BYOK cubren encryption-at-rest/no-log-leak/no-response-leak/key-rotation
- [ ] Tests de rate-limit cubren hourly/daily/circuit-breaker/per-IP
- [ ] Coverage ≥90% en `lib/security/**`
- [ ] Coverage ≥80% en `lib/query-engine/**` y `lib/db/**`
- [ ] Coverage ≥75% en `lib/connectors/**`
- [ ] Coverage ≥50% en `components/**`
- [ ] LLM responses mockeadas con MSW (no se gastan tokens en CI)
- [ ] Postgres real via Testcontainers (no SQLite mock)
- [ ] Property tests con fast-check para Zod schemas
- [ ] Golden files de LLM responses committeados para regression tests
- [ ] Playwright tests corren en chromium + firefox + mobile-safari
- [ ] Tests E2E de la suite crítica (auth + dashboard lifecycle + NLQA + demo) en <5 min
- [ ] Suite completa de tests en <15 min
- [ ] `pnpm audit` + `osv-scanner` pasan sin HIGH/CRITICAL

---

## 10. Out of scope (MVP)

- ❌ Visual regression testing (Percy/Chromatic) — Fase 2
- ❌ Load testing (k6, Artillery) — Fase 2
- ❌ Mutation testing (Stryker) — Fase 3
- ❌ Chaos engineering (kill Redis mid-test) — Fase 3
- ❌ Performance benchmarks automatizados — Fase 3

---

## 11. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Tests flaky (timing, randomness) | `faker` con seed determinístico + timeouts generosos + retry en CI |
| Testcontainers lento en CI | Cache de imagen Docker + setup paralelo |
| LLM mock no refleja comportamiento real | Golden files grabados de respuestas reales + integration tests con provider real detrás de flag |
| Coverage gaming (tests que no prueban nada) | Code review obligatorio de tests en PRs + mutation testing en Fase 3 |
| E2E tests flaky por red | Network stubs + timeouts agresivos + retries |

---

## 12. Roadmap (Fase 2+)

**Fase 2:**
- Visual regression con Chromatic (Storybook)
- Load testing automatizado en CI
- Mutation testing con Stryker (subset crítico)

**Fase 3:**
- Chaos engineering (kill Postgres/Redis mid-test)
- Performance benchmarks en PRs (regression detection)

---

## 13. Dependencias

```json
{
  "devDependencies": {
    "vitest": "^2.1.0",
    "@vitest/coverage-v8": "^2.1.0",
    "@vitest/ui": "^2.1.0",
    "@playwright/test": "^1.48.0",
    "testcontainers": "^10.13.0",
    "testcontainers-postgresql": "^10.13.0",
    "fast-check": "^3.22.0",
    "msw": "^2.6.0",
    "nock": "^13.5.0",
    "@faker-js/faker": "^9.0.0",
    "@types/node": "^22.0.0"
  }
}
```

---

## 14. Specs relacionados

- `query-engine.md` — pipeline ejecutado en integration tests
- `multi-tenant.md` — `withOrgContext()` envuelto en tenant-isolation tests
- `docs/security/threat-model.md` — los 8 vectores T1-T8 tienen tests dedicados
- `ai-generate-dashboards.md` — mocks de LLM + golden files
- `connectors.md` — contract tests de la interfaz
- `deployment.md` — CI gates asumen Docker Compose levantado
