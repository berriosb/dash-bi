---
name: dash-bi
description: Mesa de decisión moderna para leer, editar y compartir dashboards generados con datos reales.
colors:
  primary: "hsl(239 84% 67%)"
  secondary: "hsl(258 90% 66%)"
  accent: "hsl(330 81% 60%)"
  success: "hsl(160 84% 39%)"
  warning: "hsl(38 92% 50%)"
  danger: "hsl(0 84% 60%)"
  background: "hsl(0 0% 100%)"
  surface: "hsl(220 14% 96%)"
  border: "hsl(220 13% 91%)"
  text: "hsl(222 47% 11%)"
  text-muted: "hsl(220 9% 46%)"
  corporate-primary: "hsl(224 76% 40%)"
  corporate-accent: "hsl(192 91% 30%)"
typography:
  display:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "clamp(2rem, 3vw, 3rem)"
    fontWeight: 650
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.005em"
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 550
    lineHeight: 1.3
    letterSpacing: "0.02em"
rounded:
  compact: "4px"
  control: "8px"
  surface: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    height: "44px"
  widget-surface:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    rounded: "{rounded.surface}"
    padding: "{spacing.lg}"
  edit-handle:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.control}"
    size: "44px"
---

# Design System: dash-bi

## Overview

**Creative North Star: "The Decision Desk"**

dash-bi se comporta como una mesa de decisión: concentra evidencia, ordena la atención y deja espacio para actuar. El sistema es calmado, preciso y moderno; puede sostener alta densidad de información sin convertir cada dato en una tarjeta protagonista. La personalidad aparece en la jerarquía, el ritmo, el uso controlado del acento y una tipografía técnica pero humana.

La interfaz prioriza lectura de negocio antes que decoración. Cada archetype crea una topología distinta, pero todos comparten tokens, estados y componentes. La IA compone dentro del sistema; nunca diseña un sistema paralelo para cada dashboard.

**Key Characteristics:**
- Jerarquía visible entre contexto, métrica dominante, evidencia secundaria y detalle.
- Superficies claras, bordes precisos y sombras casi imperceptibles.
- Color reservado para foco, series y estados; no para llenar espacio.
- Densidad gobernada por el archetype y adaptable al viewport.
- Controles explícitos y accesibles solo cuando la persona puede actuar.

## Colors

La paleta usa neutrales fríos para lectura prolongada y acentos saturados en dosis pequeñas. Los valores normativos viven en el frontmatter y se consumen mediante variables semánticas.

### Primary
- **Signal Indigo:** acción primaria, foco seleccionado y primera serie de un chart. No funciona como fondo decorativo.
- **Corporate Blue:** reemplazo del primario en el tema `corporate`, con una presencia más sobria para reportes ejecutivos.

### Secondary
- **Analytical Violet:** segunda serie o comparación explícita; no acompaña automáticamente a todo uso del primario.

### Tertiary
- **Review Magenta:** acento excepcional para un hallazgo o foco secundario. Nunca crea gradientes con el primario.
- **Corporate Cyan:** acento del tema `corporate`, limitado a estados informativos y series relevantes.

### Neutral
- **Workspace White:** canvas y superficie base.
- **Cool Surface:** agrupación suave, encabezados de tabla y estados hover.
- **Precision Border:** separa regiones sin simular elevación pesada.
- **Ink:** texto y cifras primarias.
- **Slate Note:** metadata, ejes y texto secundario con contraste AA.

### Named Rules

**The Evidence Color Rule.** El color debe codificar una serie, un estado o una acción; si no agrega información, usa neutral.

**The No Gradient Rule.** Los dashboards de producto no usan gradientes decorativos, glows ni texto con gradiente.

**The Semantic Runtime Rule.** La IA solo puede emitir nombres de tokens y `ThemeColor`; valores literales de color se rechazan en generación y revisión.

## Typography

**Display Font:** IBM Plex Sans (con `system-ui` como fallback)
**Body Font:** IBM Plex Sans (con `system-ui` como fallback)
**Label/Mono Font:** `ui-monospace` para identificadores técnicos puntuales; las cifras usan IBM Plex Sans con números tabulares.

**Character:** IBM Plex Sans aporta precisión técnica sin parecer una plantilla SaaS genérica. Una sola familia variable reduce ruido; jerarquía, peso y números tabulares separan roles.

### Hierarchy
- **Display** (650, `clamp(2rem, 3vw, 3rem)`, 1.05): KPI hero o título de una superficie excepcional, nunca todos los números.
- **Headline** (600, 1.5rem, 1.2): título de dashboard y secciones primarias.
- **Title** (600, 0.875rem, 1.4): título de widget, corto y orientado a la métrica.
- **Body** (400, 0.875rem, 1.5): descripción, contexto y estados; máximo aproximado de 70ch.
- **Label** (550, 0.75rem, 0.02em): períodos, filtros, leyendas y metadata; evita mayúsculas sostenidas salvo encabezados de tabla breves.

### Named Rules

**The Number First Rule.** En KPIs, la cifra es el primer ancla; título, unidad y comparación explican sin competir.

**The Tabular Data Rule.** KPIs, ejes y celdas numéricas usan `font-variant-numeric: tabular-nums` para comparación estable.

## Layout

El dashboard usa una cuadrícula de 12 columnas en desktop. La posición y span vienen del schema del widget y se aplican como grid placement real, no mediante clases Tailwind construidas dinámicamente. En viewports angostos cada widget ocupa el ancho completo; tablas conservan scroll horizontal dentro de su región.

La densidad controla ritmo con tokens: `spacious` usa 24px de gap y 32px de padding; `balanced`, 16px y 24px; `dense`, 12px y 16px. El shell conserva un gutter de 16px en móvil y 24px o más en desktop. Ningún widget reduce targets interactivos bajo 44px.

El orden visual sigue el orden lógico del DOM para teclado y lectores de pantalla. Los archetypes pueden variar estructura, pero no invierten lectura ni dependen de posicionamiento puramente visual.

## Elevation & Depth

El sistema es plano por defecto. La profundidad proviene de fondo, borde y agrupación; una sombra ambiental mínima se admite en el tema `moderno-saas` para separar widgets del canvas. `corporate` no usa sombra. Drag activo puede elevar temporalmente el widget, pero el estado termina al soltar.

### Shadow Vocabulary
- **Ambient Card** (`0 1px 3px rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.06)`): separación discreta en `moderno-saas`.
- **Drag Lift** (`0 12px 30px rgb(15 23 42 / 0.14)`): solo durante arrastre activo.

### Named Rules

**The Flat-by-Default Rule.** Una superficie en reposo nunca usa glow, sombra coloreada ni múltiples capas de sombra.

## Shapes

Los controles usan curvas contenidas de 8px. Los widgets usan 12px en `moderno-saas` y 4px en `corporate`; el cambio expresa el tema, no una decisión arbitraria por componente. Estados compactos pueden usar 4px. Pills se reservan para filtros o estados realmente seleccionables; no se usan como decoración o subtítulos.

## Components

### Buttons
- **Shape:** control rectangular suavemente curvado (8px), target mínimo 44px.
- **Primary:** fondo primario, texto de alto contraste y padding horizontal de 20px.
- **Hover / Focus:** cambio tonal leve y ring visible de 2px con offset; sin escalar ni rebotar.
- **Secondary / Ghost:** borde o fondo neutral; mantiene la misma altura y foco.

### Cards / Containers
- **Corner Style:** 12px en `moderno-saas`, 4px en `corporate`.
- **Background:** surface base blanca; `Cool Surface` solo agrupa o marca encabezados.
- **Shadow Strategy:** referencia a Elevation; ninguna card se anida dentro de otra para resolver spacing.
- **Border:** un pixel semántico.
- **Internal Padding:** depende de density, no de cada widget individual.

### Inputs / Fields
- **Style:** fondo base, borde semántico, radio de 8px y altura mínima de 44px.
- **Focus:** ring primario visible y consistente con botones.
- **Error / Disabled:** mensaje cercano al campo; danger no reemplaza el texto explicativo; disabled conserva legibilidad.

### Navigation
- Navegación textual clara, estado activo visible y no dependiente solo del color. La superficie de dashboard mantiene contexto de período, fuente y estado de actualización cerca del título.

### Dashboard Widget
- Un wrapper canónico controla superficie, borde, padding, density y estados. KPI, chart y tabla expresan jerarquías internas diferentes sin duplicar estilos de shell.
- Charts usan la paleta semántica en orden estable y agregan nombre accesible o resumen textual.
- El handle de edición aparece en hover y `focus-within`, usa etiqueta española y target de 44px. No existe en modo lectura.

### Runtime Generation Contract
- La IA elige `theme`, `archetype`, `density`, `accent`, `timeWindow`, `comparativo`, tipos de widget permitidos y `ThemeColor` semánticos.
- Los renderers resuelven tokens. La salida generada no contiene hex, HSL, clases Tailwind arbitrarias, font-family, radius, shadow ni animation.
- El validator rechaza widgets fuera de bounds, overlaps, tipos no permitidos y combinaciones que contradigan el archetype.

## Do's and Don'ts

### Do:
- **Do** usar una cifra o tendencia dominante por viewport y dejar el resto como evidencia secundaria.
- **Do** usar tokens semánticos y el wrapper canónico para todos los widgets.
- **Do** conservar estados de carga, vacío, error, sin datos y edición dentro del espacio estable del widget.
- **Do** verificar desktop y móvil, foco visible, teclado, contraste AA y orden semántico antes de cerrar una pantalla.
- **Do** permitir que los archetypes varíen composición mientras temas y componentes mantienen coherencia.

### Don't:
- **Don't** anidar cards, envolver cada label en un pill ni usar icon tiles decorativos.
- **Don't** usar gradientes gratuitos, glows, bounce/elastic easing o animación sin propósito.
- **Don't** presentar todos los widgets con el mismo peso, padding y tamaño tipográfico.
- **Don't** construir clases Tailwind dinámicas desde spans generados; usa grid placement real o mapas estáticos.
- **Don't** pegar API keys en prompts, chat, archivos de diseño o artefactos de Impeccable.
- **Don't** inventar colores, fuentes o radios desde el LLM; el contrato runtime es cerrado.
