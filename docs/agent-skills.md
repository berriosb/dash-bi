# Agent Skills Setup

> Documentación canónica de cómo dash-bi maneja AI agent skills. Leé esto antes de agregar o modificar skills.

## TL;DR para nuevos contributors

```bash
# 1. Clonar repo
git clone https://github.com/<tu-user>/dash-bi
cd dash-bi

# 2. Setup de la app
cd app/ && pnpm install && pnpm db:migrate

# 3. Setup de skills (ver sección "Install" abajo)
npx impeccable install --providers=codex,opencode --scope=project --no-hooks
npx skills sync            # regenera .agents/skills/ desde skills-lock.json
```

## Política de skills — qué va en git, qué no

dash-bi distingue **3 categorías** de skills. Esta separación reduce el repo en ~2.9 MB y sigue la convención de OSS BI competidores (Metabase, Superset, Wren AI, Briefer), que no commitean tooling de agentes IA.

| Categoría | Ubicación | Tracked? | Quién la mantiene |
|---|---|---|---|
| **dash-bi-authored** (skill propio del proyecto) | `.opencode/skills/<nombre>/SKILL.md` | **SÍ** | El equipo dash-bi |
| **Vendored 3rd-party** (código del paquete npm copiado) | `.opencode/skills/<paquete>/`, `.agents/skills/<paquete>/`, `.claude/skills/<paquete>/` | **NO** | Upstream (regenerable) |
| **Per-developer** (config del agente de cada dev) | `AGENTS.md`, `skills-lock.json`, `.claude/settings.*` | **NO** | Cada contributor |

### Ejemplos concretos del estado actual

**Tracked (parte del producto):**
- `.opencode/skills/security-audit/SKILL.md` — skill propio de dash-bi (10 controles del threat model)

**Untracked pero en disco (regenerables):**
- `.opencode/skills/impeccable/` — paquete `impeccable` npm vendorizado (123 archivos, 2.9 MB)
- `.agents/skills/*` — mirror de skills de terceros para runtime opencode
- `.claude/skills/*` — mirror de skills de terceros para runtime Claude

**Untracked, per-developer:**
- `AGENTS.md` — contexto auto-inyectado al agente IA del contributor
- `skills-lock.json` — hashes de skills de terceros (referencia para `npx skills`)

## Por qué esta separación

### Repos OSS BI competidores

Ver `research/competitors.md` y `research/critical-competitors.md`. Los 5 OSS BI principales (Metabase, Superset, Lightdash, Wren AI, Briefer) commitean:
- ✅ Código de la app, tests, docs, CI/CD, licencia
- ✅ `CONTRIBUTING.md` con instrucciones para humanos

Ninguno commitea:
- ❌ Skills de AI tooling
- ❌ Config de agentes IA per-developer
- ❌ Código vendorizado de paquetes npm en su repo principal

dash-bi adopta la misma convención.

### Costos de vendorizar third-party skills en git

1. **Repo bloat:** `.opencode/skills/impeccable/` aportaba 2.9 MB / 123 archivos
2. **Histórico sucio:** cambios de upstream se mezclan con diffs de features
3. **Actualizaciones manuales:** hay que re-vendorizar a mano cuando upstream publica
4. **Atribución/licencia:** paquetes npm tienen su propia licencia; copiarlos al tree complica el NOTICE

## Install (qué corre cada contributor)

### Project-authored skills

Ya están en el repo. Nada que instalar.

### Impeccable (design tooling)

```bash
npx impeccable install --providers=codex,opencode --scope=project --no-hooks
```

- `--providers=codex,opencode`: solo instala para los runtimes que usamos
- `--scope=project`: instala en `.opencode/skills/` y `.claude/skills/` (no user-level)
- `--no-hooks`: desactiva hooks automáticos (configurados via `.impeccable/config.json`)

Verifica que no creó un hook manifest:

```bash
test ! -f .codex/hooks.json && test ! -f .claude/settings.local.json && echo "OK"
```

### Third-party skills (16 skills)

`skills-lock.json` (gitignored) tiene los hashes y sources de las 16 skills de terceros que dash-bi usa:

```bash
npx skills sync
```

Esto regenera `.agents/skills/` desde los sources en `skills-lock.json` y verifica hashes.

Si `skills-lock.json` no existe en tu clone:

```bash
npx skills add vercel/ai --skill skills/use-ai-sdk
npx skills add obra/superpowers --skill skills/dispatching-parallel-agents
# ... etc (ver skills-lock.json para la lista completa)
```

### Contrato de diseño

`.impeccable/config.json` y `.impeccable/design.json` están **tracked** porque son la fuente de verdad del design system. Impeccable los lee para detectar issues y aplicar tokens. Si querés regenerar el detector:

```bash
npx impeccable detect
```

## Agregar una nueva skill al proyecto

### Si la skill es **dash-bi-authored** (ej: security-audit, impeccable-contract)

1. Crear `.opencode/skills/<nombre>/SKILL.md`
2. Agregar entrada en el "Skills — when to invoke" section de `AGENTS.md` (per-developer)
3. Commit: `feat(tooling): add <nombre> skill`

### Si la skill es **third-party**

1. Agregar entrada a `skills-lock.json` con source + hash
2. Commit: `chore(skills): add <nombre> to lock`
3. Cada contributor corre `npx skills sync` para obtener los archivos localmente

**No** se commitean los archivos de la skill.

## Cómo se usan las skills en runtime

El runtime opencode/Claude carga skills desde:
1. `.opencode/skills/<nombre>/SKILL.md` (project-shared, tracked)
2. `.agents/skills/<nombre>/SKILL.md` (user-level, gitignored — mirror de terceros)

Si una skill de terceros no está en `.agents/skills/`, no se carga. Por eso el setup inicial corre `npx skills sync`.

## Verificación post-setup

```bash
# 1. El repo debe tener solo project-authored skills tracked
git ls-files .opencode/skills/
# → debe listar solo .opencode/skills/security-audit/SKILL.md

# 2. Los vendors deben estar en disco pero gitignored
ls .opencode/skills/impeccable/    # debe existir
ls .agents/skills/                  # debe existir con ~18 skills
ls .claude/skills/                  # debe existir con ~14 skills

# 3. git status no debe reportarlos como untracked
git status --ignored | head -20
# → .agents/, .claude/, .hermes/, .opencode/skills/impeccable/, AGENTS.md, skills-lock.json → ignored

# 4. Skill de dash-bi debe cargarse en runtime
# (el agente la invoca automáticamente cuando es relevante)
```

## Troubleshooting

**"La skill X no se carga en el agente"**

1. ¿Está en `git ls-files .opencode/skills/`? Si no, es third-party → corré `npx skills sync`
2. ¿El archivo `SKILL.md` está en la ubicación correcta? (lowercase, con `SKILL.md` literal)
3. ¿El frontmatter tiene el campo `description`? Sin él, opencode no sabe cuándo cargarla

**"Quiero regenerar Impeccable"**

```bash
rm -rf .opencode/skills/impeccable/ .agents/skills/impeccable/ .claude/skills/impeccable/
npx impeccable install --providers=codex,opencode --scope=project --no-hooks
```

**"¿Por qué mi `.agents/skills/` tiene archivos extra que no están en lock?"**

Probablemente corriste `npx skills add` ad-hoc. Limpiá con `npx skills sync --clean` o editá `skills-lock.json` para que refleje el estado real.

## Referencias

- `.gitignore` (L107-130): las reglas que aplican esta política
- `AGENTS.md` (gitignored, per-developer): contexto auto-inyectado al agente
- `docs/design/impeccable-adoption-plan.md`: plan archivado de adopción inicial
- `docs/security/threat-model.md`: origen del skill `security-audit`
- `research/critical-competitors.md`: análisis de competidores OSS BI