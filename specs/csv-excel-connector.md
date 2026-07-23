# Spec: CSV/Excel Connector

> 4º tipo de data source. El usuario sube un CSV o Excel y dash-bi lo trata como cualquier otra fuente de datos: ejecuta queries reales sobre él. **Abre top-of-funnel masivo** al resolver el "no tengo DB todavía, solo un Excel".

**Status:** Draft v0.1 (Tier 1 — recomendación competitiva)
**Prioridad:** P0 — desbloquea usuarios sin DB propia
**Responsable:** codehak
**Depende de:** `connectors.md`, `query-engine.md`, `multi-tenant.md`

---

## 1. Objetivo

Permitir que un usuario:

1. **Suba archivos CSV o Excel** (drag-drop desde la UI o file picker).
2. **Vea preview automático** de las primeras 100 filas con tipos de columna inferidos.
3. **Confirme o corrija** los tipos de columna antes de cargar.
4. **Use los archivos como data source** en cualquier dashboard, con queries SQL reales (`SELECT`, `WHERE`, `GROUP BY`).
5. **Actualice el archivo** cuando cambia (re-upload) preservando queries.

**Casos de uso típicos:**
- "Tengo el reporte de ventas en Sheets pero lo exporté a Excel" → lo subo y le pregunto cosas.
- "El cliente me mandó un CSV con 200k orders" → lo cargo y armo un dashboard.
- "Quiero probar dash-bi sin tocar mi DB" → subo un sample chico.

---

## 2. Formatos soportados

### 2.1 MVP

| Formato | Extensión | Librería | Notas |
|---------|-----------|----------|-------|
| CSV | `.csv`, `.tsv`, `.txt` | `papaparse` | Auto-detect delimiter, encoding |
| Excel | `.xlsx` | `xlsx` (SheetJS) | Solo primer sheet; multi-sheet Fase 2 |
| Excel legacy | `.xls` | `xlsx` (SheetJS) | Solo si el archivo es chico (<5MB) |

### 2.2 Límites

- **Tamaño:** 100 MB por archivo (Fase 2: subir a 500MB).
- **Filas:** 1.000.000 por archivo.
- **Columnas:** 200 por archivo.
- **Encoding:** UTF-8, Latin-1, Windows-1252 (auto-detect).
- **Delimiters CSV:** `,` `;` `\t` `|` (auto-detect).

> Si el archivo excede los límites → error claro al usuario con mensaje específico ("Tu archivo tiene 1.5M filas, máximo 1M").

---

## 3. Connector interface (extensión)

```typescript
// lib/connectors/types.ts (extensión)
export type ConnectorType = 
  | 'postgres' | 'stripe' | 'sheets' 
  | 'csv' | 'excel'    // nuevos
;

// Nuevo tipo de query para archivos
export type Query =
  | { kind: 'sql'; sql: string; params?: unknown[] }
  | { kind: 'stripe'; operation: StripeOperation; params: unknown }
  | { kind: 'sheets'; spreadsheetId: string; range: string }
  | { 
      kind: 'spreadsheet';             // unifica CSV/Excel
      fileId: string;                  // referencia al archivo cargado
    };
```

**Decisión:** un solo `Connector` que cubre `csv` y `excel` (no dos separados) — la diferencia es solo el parser inicial, después todo es una tabla SQL.

---

## 4. Modelo de datos

### 4.1 Tabla `uploaded_files`

```typescript
// db/schema.ts (extensión)
export const uploadedFiles = pgTable('uploaded_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  
  name: text('name').notNull(),                         // user-friendly name
  originalFilename: text('original_filename').notNull(),
  format: text('format').$type<'csv' | 'xlsx' | 'xls'>().notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  
  // Tabla Postgres donde se cargaron los datos
  targetTable: text('target_table').notNull(),          // ej: 'org_abc_files_orders_csv'
  rowCount: integer('row_count').notNull(),
  
  // Metadata de columnas (tipos inferidos)
  columns: jsonb('columns').$type<Array<{
    name: string;
    type: 'number' | 'string' | 'date' | 'boolean' | 'json';
    nullable: boolean;
    samples: unknown[];                                // 5 valores de muestra
  }>>().notNull(),
  
  // Storage del archivo original (re-upload, Fase 2)
  // MVP: solo targetTable; después se guarda el archivo en FS/S3 para soportar re-upload
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  orgIdx: index('uploaded_files_org_idx').on(t.orgId),
}));
```

### 4.2 Esquema SQL generado

Por cada archivo subido, se crea **una tabla Postgres dedicada** dentro de un schema tenant-scoped:

```sql
-- Schema por org: 'org_<orgId_safe>'
CREATE SCHEMA IF NOT EXISTS org_abc123;

-- Tabla para un archivo 'orders.csv' (incluye org_id para RLS genérico via columna)
CREATE TABLE org_abc123."orders_csv" (
  _row_id SERIAL PRIMARY KEY,
  org_id UUID NOT NULL,                     -- denormalizado para RLS policy
  order_date DATE,
  customer_name TEXT,
  total_cents INTEGER,
  product_id TEXT,
  -- ...columnas inferidas del CSV
);

-- RLS policy (idem resto del sistema, parametrizado via current_setting)
ALTER TABLE org_abc123."orders_csv" ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_orders_csv ON org_abc123."orders_csv"
  USING (org_id = current_setting('app.current_org_id')::uuid);

-- Índices en columnas "high-cardinality" detectadas automáticamente
CREATE INDEX ON org_abc123."orders_csv"(order_date);
CREATE INDEX ON org_abc123."orders_csv"(customer_name);
CREATE INDEX ON org_abc123."orders_csv"(org_id);   -- soporte de RLS
```

**Naming de schema:** `org_<id>` donde `<id>` es el org_id con caracteres no-alfanuméricos reemplazados.

---

## 5. Pipeline de upload

### 5.1 Flujo end-to-end

```
[1] User drop file (CSV/Excel)
       ↓
[2] /api/files/upload recibe multipart
       ↓
[3] Valida formato, tamaño, encoding (stream, no buffering full)
       ↓
[4] Stream → storage temp (FS tmp o S3)
       ↓
[5] Encola job `parse-file-{fileId}` (background)
       ↓
[6] Worker parsea → preview JSON (primeras 100 filas)
       ↓
[7] Auto-infer tipos de columna
       ↓
[8] Worker notifica al cliente (SSE o polling)
       ↓
[9] UI muestra preview: nombre tabla editable, tipos editables, columnas a excluir
       ↓
[10] User confirma → job `load-file-{fileId}` ejecuta INSERT batch
       ↓
[11] Worker crea tabla Postgres + índices + RLS
       ↓
[12] Data source aparece en lista → ready para queries
```

### 5.2 Parsing

```typescript
// lib/connectors/parsers/csv.ts
import Papa from 'papaparse';

export async function parseCSV(buffer: Buffer, encoding: string): Promise<ParsedFile> {
  const text = buffer.toString(encoding as BufferEncoding);
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h: string) => normalizeHeader(h),  // ver función abajo
      complete: (results) => {
        resolve({
          headers: results.meta.fields ?? [],
          rows: results.data,
          errors: results.errors,
        });
      },
      error: reject,
    });
  });
}

/**
 * Normaliza un header CSV/Excel a snake_case válido para Postgres.
 * - Trim whitespace
 * - Strip BOM (\uFEFF)
 * - Lowercase
 * - Reemplaza espacios y caracteres no-alfanuméricos con _
 * - Colapsa múltiples _ consecutivos
 * - Si empieza con dígito, prefix con _
 * - Trunca a 63 chars (límite de Postgres identifier)
 */
export function normalizeHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')                    // strip BOM
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')              // non-alphanumeric → _
    .replace(/_+/g, '_')                       // collapse multiple _
    .replace(/^_|_$/g, '')                     // strip leading/trailing _
    .replace(/^(\d)/, '_$1')                   // prefix _ si empieza con dígito
    .slice(0, 63)                              // Postgres identifier limit
    || 'col';                                  // fallback si queda vacío
}
```

```typescript
// lib/connectors/parsers/excel.ts
import * as XLSX from 'xlsx';

export async function parseExcel(buffer: Buffer): Promise<ParsedFile> {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];            // primer sheet en MVP
  const sheet = wb.Sheets[sheetName];
  
  // Convertir a JSON con headers
  const json = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
  const headers = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] as string[];
  
  return { headers, rows: json, errors: [] };
}
```

### 5.3 Tipo inference

```typescript
// lib/connectors/parsers/infer-types.ts

export function inferColumnTypes(rows: Array<Record<string, unknown>>): Record<string, ColumnType> {
  const result: Record<string, ColumnType> = {};
  const sampleSize = Math.min(rows.length, 500);
  
  const headers = Object.keys(rows[0] ?? {});
  for (const header of headers) {
    const values = rows.slice(0, sampleSize).map(r => r[header]).filter(v => v != null);
    if (values.length === 0) {
      result[header] = { type: 'string', nullable: true };
      continue;
    }
    
    const counts = { number: 0, date: 0, boolean: 0, string: 0 };
    for (const v of values) {
      const t = detectType(v);
      counts[t]++;
    }
    
    // Tipo mayoritario (>= 80% de los valores)
    const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const winnerPct = winner[1] / values.length;
    
    result[header] = {
      type: winnerPct >= 0.8 ? winner[0] as any : 'string',  // si ambiguo, string
      nullable: values.length < sampleSize,
    };
  }
  return result;
}

function detectType(v: unknown): 'number' | 'date' | 'boolean' | 'string' {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (v instanceof Date) return 'date';
  if (typeof v === 'string') {
    if (/^-?\d+(\.\d+)?$/.test(v.trim())) return 'number';
    if (/^(true|false)$/i.test(v.trim())) return 'boolean';
    if (/^\d{4}-\d{2}-\d{2}/.test(v.trim())) return 'date';
  }
  return 'string';
}
```

### 5.4 SQL injection mitigation (CSV is not SQL, but...)

CSV/Excel **no ejecuta SQL**, pero Excel tiene **formula injection** (CSV también es vulnerable si la celda empieza con `=`/`+`/`-`/`@`):

```typescript
// lib/connectors/parsers/sanitize.ts

export function sanitizeCellValue(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  // Si el valor empieza con caracteres peligrosos en Excel/csv → prefix
  if (/^[=+\-@]/.test(v.trim())) {
    return `'${v}`;       // prefix con apostrofe neutraliza fórmulas
  }
  return v;
}

export function sanitizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, sanitizeCellValue(v)])
  );
}
```

**Critical:** sanitizar SIEMPRE al cargar, no después. Si se importan 100k rows con posibles inyecciones, filtrar al momento.

---

## 6. Loader (worker)

### 6.1 Bulk insert optimizado

```typescript
// lib/workers/load-file.ts
import { Worker } from 'bullmq';
import { COPY } from 'pg-copy-streams';

export const loadFileWorker = new Worker('load-file', async (job) => {
  const { fileId, targetTable, rows, columns } = job.data;
  
  await withOrgContext(fileOrgId, async () => {
    const sql = generateCreateTableSQL(targetTable, columns);
    await db.execute(sql);
    
    // COPY es 10-100x más rápido que INSERT batch
    const stream = client.query(COPY(`COPY ${targetTable} FROM STDIN WITH CSV HEADER`));
    const stringify = stringifyStream({ header: false, columns: columns.map(c => c.name) });
    Readable.from(rows).pipe(stringify).pipe(stream);
    await new Promise((res, rej) => { stream.on('finish', res); stream.on('error', rej); });
    
    // Índices en columnas high-cardinality detectadas
    await createIndexes(targetTable, columns);
    
    // RLS
    await db.execute(`ALTER TABLE ${targetTable} ENABLE ROW LEVEL SECURITY`);
    await db.execute(generateRLSPolicy(targetTable, fileOrgId));
  });
  
  await job.updateProgress(100);
}, {
  connection: redis,
  concurrency: 1,             // 1 file load a la vez (heavy IO)
  timeout: 300_000,           // 5 min budget por archivo
});
```

**Performance:**
- 1M rows: ~30-60 segundos con COPY FROM STDIN.
- Si excede 5min → abortar y notificar al usuario.

### 6.2 Progress tracking (SSE)

```typescript
// app/api/files/[id]/events/route.ts (Server-Sent Events)
export async function GET(req: Request, { params }) {
  const stream = new ReadableStream({
    async start(controller) {
      const sub = redis.subscribe(`file-progress:${params.id}`);
      sub.on('message', (data) => {
        controller.enqueue(`data: ${data}\n\n`);
      });
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}
```

---

## 7. Connector: ejecutando queries

### 7.1 Implementación del connector

```typescript
// lib/connectors/implementations/spreadsheet.ts
import { Client } from 'pg';

export class SpreadsheetConnector implements Connector {
  type: 'spreadsheet' = 'spreadsheet';
  private fileId: string;
  private targetTable: string;
  
  constructor(config: { fileId: string; targetTable: string; orgId: string }) {
    this.fileId = config.fileId;
    this.targetTable = config.targetTable;
  }
  
  async testConnection() {
    // Verificar que la tabla existe
    const result = await db.execute(sql`
      SELECT 1 FROM ${sql.identifier(this.targetTable)} LIMIT 1
    `);
    return { ok: result.rows.length > 0, latencyMs: ... };
  }
  
  async getSchema(): Promise<ConnectorSchema> {
    const cols = await db.execute(sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = ${this.targetTable}
    `);
    return {
      tables: [{
        name: this.targetTable,
        columns: cols.rows.map(c => ({
          name: c.column_name,
          type: mapPgType(c.data_type),
        })),
      }],
    };
  }
  
  async executeQuery(query: Query): Promise<QueryResult> {
    if (query.kind !== 'spreadsheet') {
      throw new Error('Spreadsheet connector only supports spreadsheet queries');
    }
    if (query.fileId !== this.fileId) {
      throw new Error('fileId mismatch');
    }
    
    // Para queries sobre spreadsheet: la IA genera SQL
    // (reutilizamos la validación del connector postgres)
    const sqlQuery = buildSQLFromSpreadsheetQuery(query);
    validateQuery(sqlQuery, 'postgres');        // reusa el validate del postgres connector
    
    const result = await db.unsafe(sqlQuery);
    return { rows: result, rowCount: result.length, executionTimeMs: ... };
  }
}
```

**Decisión clave:** el connector `spreadsheet` es esencialmente un sub-tipo del postgres connector — ejecuta SQL sobre una tabla específica. Reusa toda la lógica de validación + cache del query-engine.

### 7.2 Cómo la IA genera queries

En el system prompt (ver `ai-generate-dashboards.md` §6), se inyecta el schema del spreadsheet:

```
# DATA SOURCE: orders.csv (uploaded 2026-07-22)
Tables:
  - orders_csv:
    - order_date: date
    - customer_name: string
    - total_cents: number
    - product_id: string

Generate SQL like:
  SELECT order_date, SUM(total_cents)/100 AS revenue 
  FROM orders_csv 
  WHERE order_date >= NOW() - INTERVAL '30 days'
  GROUP BY order_date
  ORDER BY order_date
```

Es idéntico al flujo Postgres existente, solo que con `source.kind: 'spreadsheet'` apuntando a un archivo.

---

## 8. UI: wizard de upload

### 8.1 Step 1: Drop

```
┌────────────────────────────────────────────────┐
│ Subí tu archivo                               │
│                                                │
│ ┌────────────────────────────────────────┐   │
│ │  ⬆                                         │
│ │                                          │
│ │  Arrastrá tu archivo aquí                │
│ │  o [Elegir archivo]                      │
│ │                                          │
│ │  CSV, TSV, XLSX hasta 100MB, 1M filas  │
│ └────────────────────────────────────────┘   │
│                                                │
│ [Cancelar]                                     │
└────────────────────────────────────────────────┘
```

### 8.2 Step 2: Preview

```
┌────────────────────────────────────────────────┐
│ Vista previa: orders.csv                       │
│ 1,247 filas detectadas · 8 columnas           │
│                                                │
│ Nombre de la tabla: [orders_csv      ]        │
│                                                │
│ │ column       │ type      │ preview          │
│ │──────────────┼───────────┼──────────────────│
│ │ ✓ order_date  │ date     │ 2026-01-15       │
│ │ ✓ customer    │ string   │ "Acme Corp"      │
│ │ ✓ total_cents │ number   │ 125000           │
│ │ ✓ status      │ string   │ "completed"      │
│ │ ...                                      │
│                                                │
│ [Cancelar]  [Atrás]  [Cargar al sistema →]    │
└────────────────────────────────────────────────┘
```

- Tipos editables por columna (dropdown: string/number/date/boolean/json).
- Checkbox por columna para excluir.
- Nombre de tabla editable (default = filename sin extensión).

### 8.3 Step 3: Loading

```
┌────────────────────────────────────────────────┐
│ Cargando orders.csv...                         │
│                                                │
│ ████████████░░░░░░░░  62%   770/1247 filas    │
│                                                │
│ Estimado: ~15 segundos restantes               │
│                                                │
│ [Cancelar]                                     │
└────────────────────────────────────────────────┘
```

Progress visible vía SSE.

### 8.4 Step 4: Done

```
┌────────────────────────────────────────────────┐
│ ✓ orders.csv está listo                        │
│                                                │
│ 1,247 filas cargadas · ~4MB                    │
│ Tabla SQL: org_abc."orders_csv"                │
│                                                │
│ ¿Qué querés hacer?                             │
│ [🤖 Generar dashboard con IA]                  │
│ [📊 Ver SQL directo]                            │
│ [⏭ Seguir más tarde]                          │
└────────────────────────────────────────────────┘
```

---

## 9. Update / Replace / Delete

### 9.1 Re-upload (Fase 2)

Para MVP, **delete + re-upload**. El usuario borra el archivo viejo y sube el nuevo.
- La interfaz es fea pero segura.
- Fase 2: el sistema detecta el mismo filename y pregunta "¿Reemplazar el archivo X?" preservando queries que referencian la misma tabla.

### 9.2 Delete

- Soft delete por default (borrar data pero mantener el row en `uploaded_files` con `deletedAt`).
- Después de 30 días: hard delete del schema `org_abc123` y de la fila.
- "Borrar demo" del demo-mode también limpia estos archivos.

---

## 10. Seguridad

### 10.1 Defense in depth

| Capa | Mitigación |
|------|-----------|
| Upload validation | Tamaño máximo, formato (whitelist), MIME type check, magic bytes |
| Formula injection | `sanitizeCellValue()` en TODA celda que empieza con `=+-@` |
| SQL injection | Reusa `validateQuery()` del postgres connector |
| RLS | Schema `org_<id>` + policy por tabla |
| Disk exhaustion | Rate limit 1 upload simultáneo por org; cuota total de uploads por plan |
| Malicious data | 100MB hard cap; antivirus en Fase 2 |

### 10.2 Rate limits

```typescript
const FILE_UPLOAD_LIMITS = {
  free:        { maxFileSizeMB: 25,  maxFiles: 5,  maxRowsPerFile: 100_000 },
  pro:         { maxFileSizeMB: 100, maxFiles: 50, maxRowsPerFile: 1_000_000 },
  enterprise:  { maxFileSizeMB: 500, maxFiles: -1, maxRowsPerFile: -1 },
};
```

### 10.3 Almacenamiento del archivo original

MVP: **no se guarda** el archivo original después de cargar (solo la tabla SQL).
- Pro: ahorra disco, simplifica arquitectura.
- Con: re-upload requiere que el usuario conserve el archivo.

Fase 2: storage en FS local (`/var/lib/dash-bi/uploads/`) → R2/S3 con lifecycle.

---

## 11. Acceptance criteria

- [ ] Usuario puede subir un CSV de hasta 100MB vía drag-drop
- [ ] Encoding se auto-detecta (UTF-8, Latin-1, Windows-1252)
- [ ] Delimiter se auto-detecta (`,` `;` `\t` `|`)
- [ ] Tipos de columna se infieren correctamente (number/date/boolean/string)
- [ ] Usuario puede editar tipos antes de confirmar
- [ ] Usuario puede excluir columnas antes de confirmar
- [ ] Nombre de la tabla es editable
- [ ] Formula injection se sanitiza (`=cmd()`, `+1+1`, etc.)
- [ ] Archivo se carga en background; UI muestra progress
- [ ] Una vez cargado, la tabla es consultable via SQL desde el connector spreadsheet
- [ ] Queries se ejecutan via query-engine (cache + validación)
- [ ] RLS activo en cada tabla creada (org isolation)
- [ ] User puede eliminar el archivo desde la UI
- [ ] Cross-tenant access bloqueado por RLS (test de seguridad)
- [ ] Archivo Excel multi-sheet usa solo el primer sheet (Fase 2: selector de sheet)

---

## 12. Out of scope (MVP)

- ❌ Multi-sheet Excel selector (Fase 2)
- ❌ Reemplazo automático de archivos (Fase 2 — MVP requiere delete + re-upload)
- ❌ Mantener archivo original en storage (Fase 2 — solo SQL table)
- ❌ CSV streaming para archivos >100MB (Fase 2)
- ❌ Editar celdas en el preview
- ❌ Merge de múltiples archivos en una tabla
- ❌ Conexión a Google Drive / Dropbox para auto-sync
- ❌ S3/R2 directo como data source
- ❌ Antivirus / scan de archivos
- ❌ Versionado del archivo (Fase 3)

---

## 13. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Archivo malformado rompe el parser | Try/catch + mensaje claro + retry sin commit |
| Tipos mal inferidos dan SQL inválido | User edita tipos en preview antes de confirmar |
| Formula injection en Excel | Sanitize on load + tests con payloads conocidos |
| 1M rows × 200 cols → tabla muy ancha | Auto-skip columns con >80% null values; cap 200 cols |
| Worker de load se cuelga >5min | Timeout + retry 1 + cleanup de schema parcial |
| Disco lleno con archivos | Rate limit + cuota por plan + cleanup automático |
| Unicode/encoding raro genera chars inválidos | Auto-detect + fallback UTF-8; warning si encoding no estándar |
| Concurrencia: dos users suben archivos con mismo nombre | Renombrar automático: `orders_csv_2`, `orders_csv_3` |
| Schema pollution (cada org tiene su schema) | Naming estricto + cleanup al delete; Fase 2: shared `org_data` schema con columna org_id |

---

## 14. Dependencias

```json
{
  "dependencies": {
    "papaparse": "^5.4.1",
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
    "pg-copy-streams": "^6.0.0",
    "stringify": "^1.3.0"
  }
}
```

`pg-copy-streams` para bulk insert (10-100x más rápido que INSERT batch). `stringify` para serializar rows a CSV que `COPY FROM STDIN` puede consumir.

---

## 15. Specs relacionados

- `connectors.md` — este spec implementa el connectorType `'csv' | 'excel' | 'spreadsheet'`
- `query-engine.md` — sin cambios; las queries se ejecutan idénticas sobre la tabla SQL generada
- `widget-system.md` — los widgets pueden referenciar archivos como `source.kind: 'query'` con `kind: 'spreadsheet'`
- `multi-tenant.md` — RLS en `uploaded_files` + en cada tabla creada
- `onboarding.md` — wizard de upload reemplaza/complementa el de Postgres
- `demo-mode.md` — los datos sintéticos también podrían usar este mecanismo internamente (Fase 2)
