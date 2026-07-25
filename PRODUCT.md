# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

El usuario primario es Bastian en un próximo trabajo: una persona responsable de analizar datos, preparar reportes y explicar resultados a clientes, equipos o jefaturas sin depender de licencias Microsoft. Usa la herramienta en desktop durante trabajo analítico y puede compartir resultados en PDF, PNG o enlaces públicos.

El usuario secundario futuro son equipos pequeños, PYMEs y consultoras que necesitan BI self-hosted, moderno y configurable sin montar un stack de data engineering complejo.

## Product Purpose

dash-bi convierte una solicitud en lenguaje natural en un dashboard editable construido con datos reales de una fuente conectada. Su propósito es reducir el tiempo entre conectar datos, entender una situación y producir un reporte presentable.

El éxito del producto significa que una persona puede conectar Postgres, Stripe o Google Sheets, generar una primera lectura útil, corregirla manualmente y compartirla sin abandonar la aplicación.

## Positioning

La combinación diferenciadora es open source + self-hosted + IA que compone dashboards completos con datos reales + elección de proveedor LLM + edición manual. Un producto vecino puede ofrecer chat sobre datos o dashboards predefinidos, pero no puede afirmar la misma combinación de generación estructural, design diversity mediante archetypes y portabilidad on-premise.

## Operating Context

- Flujo principal: conectar fuente → describir qué se necesita → generar dashboard → revisar datos → editar layout/widgets → exportar o compartir.
- Fuentes MVP: PostgreSQL, Stripe y Google Sheets.
- Salidas: aplicación web, PDF con branding, PNG y link público sin autenticación.
- Implementación y evaluación ocurren principalmente en desktop; los enlaces públicos deben seguir siendo legibles en pantallas pequeñas.
- La aplicación es monolingüe en español durante el MVP. Los identificadores de código permanecen en inglés.

## Capabilities and Constraints

- Next.js 16, React 19.2, TypeScript strict, Tailwind CSS 4, shadcn/ui y Tremor/Recharts.
- PostgreSQL 16 y Drizzle ORM; multi-tenancy mediante `org_id`, RLS y RBAC.
- Vercel AI SDK v6 con OpenAI, Anthropic y Gemini configurables por organización.
- Siete widgets permitidos: KPI, line, bar, pie, area, scatter y table.
- Ocho archetypes curados más composición `custom`; el resultado sigue siendo editable.
- Dos temas MVP: `moderno-saas` y `corporate`. Dark mode se difiere a Fase 2.
- La IA debe usar tokens semánticos, widgets permitidos y constraints de archetype. No puede inventar colores, radios, tipografías, sombras o animaciones.
- Seguridad no negociable: aislamiento por organización, consultas read-only, validación SQL, cifrado AES-256-GCM de BYOK y redacción de secretos.
- Hecho abierto: el producto aún no tiene usuarios externos, testimonios ni métricas públicas de adopción; futuras superficies no deben fabricarlos.

## Brand Commitments

- Nombre: `dash-bi`, en minúsculas y con guion.
- Marca neutral; no es una marca personal.
- Voz: directa, precisa, sobria y en español; explica términos técnicos en vez de presumir conocimiento.
- Promesa visual confirmada: moderno y presentable, sin apariencia BI legacy ni estética genérica generada por IA.

## Evidence on Hand

- `SPEC.md` es la fuente única de verdad del producto.
- `specs/dashboard-archetypes.md` define el vocabulario de diversidad visual.
- `specs/ai-generate-dashboards.md`, `specs/manual-editing.md` y `specs/layouts-themes.md` definen generación, edición y temas.
- `app/src/lib/widgets/` contiene tipos, archetypes y validadores implementados.
- `app/src/components/dashboard/` y `app/src/components/widgets/` contienen el renderer actual.
- Existe una suite automatizada de unit/security tests; todavía no hay evidencia pública de uso real, clientes o benchmarks del producto.

## Product Principles

1. **Datos reales antes que demos bonitas.** Ningún widget de producción presenta números ficticios como si provinieran de la fuente conectada.
2. **IA propone; la persona conserva control.** Todo dashboard generado debe poder editarse, reorganizarse, regenerarse y exportarse.
3. **Diversidad con constraints.** Los archetypes producen resultados distintos sin sacrificar legibilidad, seguridad ni coherencia visual.
4. **Self-hosted sin castigo UX.** Portabilidad y control de datos no justifican una interfaz compleja o legacy.
5. **Errores claros antes que fallbacks engañosos.** Si una query o generación falla, la interfaz lo explica y ofrece una acción segura.

## Accessibility & Inclusion

Las superficies deben cumplir WCAG 2.2 AA en contraste y navegación por teclado. El foco siempre es visible; controles interactivos tienen un target mínimo de 44px; charts y estados no dependen solo del color; tablas usan estructura semántica; drag-and-drop mantiene alternativa de teclado. La copy evita jerga innecesaria y los números usan formato legible para el contexto hispanohablante.
