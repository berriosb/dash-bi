# Contributing to dash-bi

¡Gracias por querer contribuir! dash-bi es open source (AGPL v3) y todo aporte suma: código, docs, issues, reportes de bug, ideas.

## Cómo empezar

1. **Lee las specs.** La carpeta [`specs/`](./specs) describe features en detalle. Empezá por [`SPEC.md`](./SPEC.md) y [`PRODUCT.md`](./PRODUCT.md).
2. **Mirá la arquitectura.** [`docs/IMPLEMENTATION-PLAN-v1.0.md`](./docs/IMPLEMENTATION-PLAN-v1.0.md) tiene el plan completo y decisiones congeladas.
3. **Buscá un issue abierto** o abrí uno nuevo describiendo el cambio propuesto.

## Workflow

```bash
# 1. Fork + clone
git clone https://github.com/<tu-user>/dash-bi
cd dash-bi

# 2. Crear branch
git checkout -b feat/mi-feature

# 3. Setup local
cd app/
cp .env.example .env.local
docker compose up -d postgres redis
pnpm install
pnpm db:migrate
pnpm db:setup-rls

# 4. Hacer cambios + tests
pnpm test            # unit + security
pnpm test:e2e        # playwright
pnpm lint
pnpm typecheck

# 5. Commit (conventional commits)
git commit -m "feat(dashboard): add property panel"

# 6. Push + PR
git push origin feat/mi-feature
gh pr create --base main
```

## Convenciones

### Branches

- `feat/<scope>` — nuevas features
- `fix/<scope>` — bugfixes
- `chore/<scope>` — tareas internas (deps, refactors sin impacto)
- `docs/<scope>` — solo documentación
- `test/<scope>` — solo tests

### Commits

Conventional Commits. Scopes comunes: `auth`, `dashboard`, `widgets`, `connectors`, `ai`, `db`, `theme`, `export`, `tests`, `ci`.

Ejemplos válidos:
- `feat(auth): add password reset flow`
- `fix(widgets): prevent NaN in KPI when source is empty`
- `chore(deps): bump drizzle-orm to 0.36.0`
- `docs(readme): clarify multi-tenant setup`

### Code style

- **TypeScript strict.** Todos los PRs deben pasar typecheck.
- **ESLint 9 flat config.** Regla custom `no-raw-db-queries` activa en `/app/api/`: no usar `db.select()` directo, hay que ir por `withOrgContext()`.
- **No comments innecesarios.** El código debería ser self-explanatory; comentá solo el "por qué" no el "qué".
- **Tests obligatorios** para lógica de seguridad, query engine, RLS, AI gateway, validators.

### Multi-tenant (regla de oro)

**Toda query a la DB debe pasar por `withOrgContext(orgId, userId, fn)`.** La ESLint rule `no-raw-db-queries` rechaza automáticamente `db.select()` directo en API routes. Si ves un error de ESLint por esto, no lo silencies — es una fuga de tenant.

### AI / security

- El gateway AI (`app/src/lib/ai/gateway.ts`) es la única forma de generar SQL. No construir SQL desde cero en otros lados.
- Toda query generada por IA pasa por `validateQuery()` (SELECT-only, LIMIT auto-inject, table allowlist).
- DB user read-only para queries de IA.
- No loguear prompts ni respuestas. Logger Pino redacta automáticamente.

## Estructura de PRs

- **Título claro:** `feat(scope): description`.
- **Descripción:** qué cambia, por qué, cómo se prueba. Si arregla un issue, referenciarlo con `Closes #123`.
- **Tests:** incluir test que falla antes del fix y pasa después.
- **Screenshots/GIFs** si hay cambio visual.
- **Checklist del template:**
  - [ ] Tests pasan local (`pnpm test`)
  - [ ] E2E pasa si hay cambio de UI (`pnpm test:e2e`)
  - [ ] Lint + typecheck (`pnpm lint && pnpm typecheck`)
  - [ ] Sin secrets committeados
  - [ ] Doc actualizado si corresponde

## Reportar bugs

Usá el template de issue. Incluí:

- Reproducción (pasos mínimos)
- Esperado vs real
- Versión (commit hash)
- OS + Node version
- Logs relevantes (sin secrets)

## Sugerir features

Abrí un issue con tag `enhancement`. Antes de codear, esperá feedback de un maintainer para alinearnos con la dirección del producto.

## Áreas necesitadas

- 🌍 **i18n:** español es MVP, pero el código debería ser i18n-ready.
- ♿ **a11y:** WCAG 2.2 AA es target.
- 📊 **widgets nuevos:** table compound, sankey, pivot. Pedí antes — hay un allowlist de 7 para MVP.
- 🔌 **conectores nuevos:** BigQuery, MySQL, Snowflake. Después de MVP.
- 🤖 **LLM providers:** Cohere, Mistral, local (Ollama). Después de MVP.

## License

Al贡献ir, aceptás que tu código se licencia bajo AGPL v3 — la misma que el proyecto.
