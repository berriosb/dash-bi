# Shape brief — superficie de dashboard

**Estado:** dirección cerrada para primera integración de Impeccable
**Target:** `app/src/components/dashboard/DashboardGrid.tsx` y widgets asociados

- **Trabajo y audiencia:** una persona de negocio abre un dashboard para entender qué cambió, identificar el dato que requiere atención y decidir qué reportar o investigar; debe poder leerlo sin conocer la implementación ni reconstruir la jerarquía del archetype.
- **Resultado principal:** en menos de diez segundos debe reconocer título/contexto, período/comparativo, KPI o tendencia dominante y estado de los datos. En modo edición debe distinguir claramente qué se puede mover, sin contaminar el modo lectura.
- **Dirección:** **The Decision Desk**. Una mesa de decisión sobria: datos nítidos, superficies planas con separación precisa, densidad controlada por archetype y acento usado solo para estado o foco. El dashboard debe sentirse propio de BI, no una cuadrícula genérica de cards SaaS.
- **Jerarquía:** shell semántico con encabezado del dashboard, metadata útil del archetype y una región de widgets. KPI hero, KPIs secundarios, charts y tablas deben expresar jerarquías distintas; no todos los widgets pueden tener el mismo peso visual.
- **Layout:** grid real de 12 columnas en desktop; en pantallas pequeñas cada widget ocupa el ancho disponible y conserva un mínimo legible. La densidad `spacious | balanced | dense` controla gap y padding mediante tokens; los spans generados no dependen de clases Tailwind dinámicas.
- **Interacción:** lectura por defecto sin controles flotantes. En edición, cada widget obtiene un handle visible al foco/hover, target mínimo de 44px, etiqueta en español y soporte de teclado de dnd-kit. Arrastrar no debe alterar el contenido ni ocultar el foco.
- **Estados:** dashboard vacío, widget sin datos, carga, error y tipo no soportado deben ser explícitos y contenidos en el mismo espacio del widget. Nunca convertir `0` en “sin datos”. Errores usan los componentes tipados existentes.
- **Responsive y accesibilidad:** contraste WCAG AA, foco visible, landmarks y headings con orden lógico, tablas con encabezados semánticos, charts con nombre accesible/resumen y sin depender únicamente del color.
- **Límites:** preservar shadcn/ui, Tremor/Recharts, dnd-kit, los ocho archetypes, los dos themes y la edición manual. No agregar dark mode, nuevos widgets, navegación global, backend ni animaciones decorativas.
- **Runtime:** la IA solo selecciona tokens semánticos, widgets permitidos, theme, density y archetype. No puede emitir colores, radios, tipografías, sombras ni animaciones arbitrarias.
