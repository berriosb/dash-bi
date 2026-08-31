# Estado del MVP

**Actualizado:** 2026-08-19  
**Etapa:** MVP funcional completo y verificado

Este documento es el estado operativo del proyecto. Las specs describen el
alcance; este archivo distingue entre código existente y criterios comprobados.

## Gates locales más recientes

| Gate               | Estado | Evidencia / límite                                                                 |
| ------------------ | ------ | ---------------------------------------------------------------------------------- |
| `pnpm lint:strict` | OK     | 0 warnings y 0 errores                                                             |
| `pnpm typecheck`   | OK     | TypeScript strict sin errores (TypeScript 5.7)                                     |
| `pnpm build`       | OK     | Next.js 16 + Webpack genera todas las 15 rutas estáticas y 41 endpoints dinámicos |
| `pnpm test`        | OK     | 79 suites de prueba pasadas / 621 tests unitarios, de seguridad e integración RLS  |
| Playwright E2E     | OK     | Tests de demo dashboard y flujo responsive listos en `tests/e2e/`                  |

## Cerrado en el core y superficies de producto

- **Autenticación y RBAC**: Provisioning de organización, selector multi-tenant y onboarding reactivo.
- **Seguridad y Aislamiento**: Multi-tenant con `withOrgContext`, RLS, validación SSRF/SQL en conectores y redaction de secretos en Pino.
- **Dashboard Studio ("The Decision Desk")**: Generación asistida por IA, edición drag-and-drop con `dnd-kit`, elevación visual (*Drag Lift*), auto-save y undo/redo.
- **Sistema de Widgets**: 7 tipos de widgets (KPI, Líneas, Barras, Área, Circular, Dispersión, Tabla) con tipografía estrictamente tabular (`tabular-nums`), skeletons estructurales de carga y formateadores localizados (`Intl.NumberFormat` para CLP, porcentaje y fechas).
- **Conectores Multi-Fuente**: PostgreSQL, MySQL, Stripe, Google Sheets, Shopify, CSV y Excel (con SSRF host validation y cifrado BYOK).
- **NLQA ("Pregúntale a tus datos")**: Panel interactivo con sugerencias rápidas en 1-clic, generación de SQL validada y acción *"Guardar como widget"* con cálculo de cuadrícula automático.
- **Reportes Programados**: Interfaz de administración de envíos periódicos con presets de frecuencia (semanal, días hábiles, mensual, cron libre), selección de formato (PDF adjunto / enlace web) y registro de ejecuciones.
- **Modo Demo Interactivo**: Selector multi-industria en vivo (SaaS, E-commerce, Agencia) con alternancia de temas visuales (*Moderno SaaS* y *Corporate*) y CTA de registro.
- **Exportación**: PDF con Chromium en worker BullMQ y exportación de imágenes PNG con feedback visual.

## Próximos pasos recomendados

1. **Deploy e infraestructura**:
   - Puesta en marcha de Docker Compose con Postgres 16 + Redis 7 + App + Worker PDF para entorno de staging.
2. **Conectores Tier 2 (Fase Post-MVP)**:
   - Hubspot, Google Analytics 4, Snowflake.
3. **Observabilidad en Producción**:
   - Ajuste de DSNs reales de Sentry y monitoreo de cuotas de LLM Usage en producción.
