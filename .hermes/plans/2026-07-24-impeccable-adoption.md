# Impeccable Adoption Implementation Plan

> **For Hermes:** Execute this plan task-by-task and verify every user-visible change in a real browser.

**Goal:** Integrate Impeccable into dash-bi as project-scoped design guidance for OpenCode and Codex, establish durable product/design context, and use it to improve one representative dashboard surface without enabling automatic hooks or CI gates.

**Architecture:** Keep Impeccable vendored inside the repository under its provider-native skill folders. Treat root `PRODUCT.md` as durable product truth and root `DESIGN.md` plus `.impeccable/design.json` as the visual contract. Apply the contract both to the application shell and to runtime dashboard generation through semantic tokens and documented widget/archetype constraints.

**Tech Stack:** Impeccable CLI 3.3.x, OpenCode, Codex, Next.js 16, React 19.2, TypeScript strict, Tailwind CSS 4, shadcn/ui, Tremor/Recharts, Playwright.

---

### Task 1: Correct project-scoped installation

**Objective:** Install provider-native Impeccable skills only for OpenCode and Codex, with no automatic hooks.

**Files:**
- Create: `.opencode/skills/impeccable/**`
- Create: `.agents/skills/impeccable/**`
- Do not create: `.codex/hooks.json`, `.claude/settings.local.json`

**Steps:**
1. Run `npx impeccable install --providers=codex,opencode --scope=project --no-hooks` from the repository root.
2. Verify both skill folders exist.
3. Verify no hook manifest was installed.
4. Run a smoke check that OpenCode sees the project-local skill.

### Task 2: Capture durable product context

**Objective:** Create a truthful `PRODUCT.md` from confirmed repository evidence and the user's existing project decisions.

**Files:**
- Create: `PRODUCT.md`

**Steps:**
1. Read `SPEC.md`, key feature specs, and the app README.
2. Record platform, primary user, purpose, positioning, operating context, constraints, evidence, principles, and accessibility requirements.
3. Mark unresolved product facts explicitly; do not invent customers, benchmarks, or pricing.
4. Validate the Impeccable product schema marker.

### Task 3: Capture the visual design system

**Objective:** Create a portable, machine-readable design contract aligned with the existing themes and component stack.

**Files:**
- Create: `DESIGN.md`
- Create: `.impeccable/design.json`
- Create: `.impeccable/config.json`

**Steps:**
1. Extract incumbent tokens from `app/src/app/globals.css`, Tailwind config, shadcn button, and widget components.
2. Define semantic colors, typography, spacing, radius, component variants, elevation, responsive behavior, and named rules.
3. Add runtime-generation guardrails for dashboard widgets and archetypes.
4. Disable the design hook in shared Impeccable config.
5. Run Impeccable context/doctor checks.

### Task 4: Shape and implement a representative dashboard surface

**Objective:** Improve the dashboard renderer as the first representative surface, preserving all data and editing behavior.

**Files:**
- Create: `docs/design/dashboard-surface-brief.md`
- Modify: `app/src/components/dashboard/DashboardGrid.tsx`
- Modify: `app/src/components/widgets/*.tsx` as required
- Modify: `app/src/app/globals.css`
- Create or modify: a real route/demo fixture only if needed for browser verification

**Steps:**
1. Write a concise shape brief covering the primary BI-reading job, hierarchy, states, responsive layout, and non-goals.
2. Run an independent design assessment before detector results.
3. Run Impeccable detector separately and persist the critique snapshot.
4. Implement only the high-impact findings: token consistency, dashboard hierarchy, responsive layout, semantic states, and accessible controls.
5. Preserve shadcn/ui, Tremor/Recharts, dnd-kit behavior, two themes, and Spanish UI copy.

### Task 5: Verify and hand off

**Objective:** Prove the integration and representative surface work with real output.

**Files:**
- Create: `docs/design/impeccable-adoption.md`

**Steps:**
1. Run `npx impeccable detect` against the scoped UI.
2. Run formatting, typecheck, unit/security tests, and production build.
3. Start the app and interact with the representative screen in a real browser at desktop and mobile widths.
4. Inspect browser console and DOM state programmatically.
5. Review the full diff for security, logic, scope, and maintainability.
6. Record what is adopted now, what remains deferred, and the commands future contributors should use.
7. Leave changes uncommitted for Bastian's review; do not push.
