'use client';

import * as React from 'react';
import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  UploadCloud,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowLeft,
  X,
  Table as TableIcon,
} from 'lucide-react';

export type ColumnType = 'string' | 'number' | 'date' | 'boolean' | 'json';

export interface InferredColumnState {
  name: string;
  type: ColumnType;
  nullable: boolean;
  samples: unknown[];
}

export interface UploadedFilePreview {
  fileId: string;
  name: string;
  format: 'csv' | 'xlsx' | 'xls';
  sizeBytes: number;
  proposedTargetTable: string;
  inferredColumns: InferredColumnState[];
  previewRows: Array<Record<string, unknown>>;
  totalRows: number;
}

export interface FileUploadModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialType?: 'csv' | 'excel';
}

export function FileUploadModal({
  open,
  onClose,
  onSuccess,
  initialType = 'csv',
}: FileUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Uploaded state
  const [preview, setPreview] = useState<UploadedFilePreview | null>(null);
  const [datasetName, setDatasetName] = useState('');
  const [columns, setColumns] = useState<InferredColumnState[]>([]);

  if (!open) return null;

  const handleReset = () => {
    setPreview(null);
    setDatasetName('');
    setColumns([]);
    setError(null);
    setUploading(false);
    setCommitting(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleModalClose = () => {
    handleReset();
    onClose();
  };

  const uploadFile = async (file: File) => {
    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data?.message ?? data?.error ?? 'Error al subir el archivo.';
        throw new Error(msg);
      }

      setPreview(data);
      setDatasetName(data.name?.replace(/\.[^/.]+$/, '') || 'Datos importados');
      setColumns(data.inferredColumns ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al procesar el archivo.');
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      uploadFile(file);
    }
  };

  const handleColumnTypeChange = (index: number, newType: ColumnType) => {
    setColumns((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index]!, type: newType };
      }
      return next;
    });
  };

  const handleCommit = async () => {
    if (!preview) return;
    setError(null);
    setCommitting(true);

    try {
      const payload = {
        fileId: preview.fileId,
        name: datasetName.trim() || preview.name,
        columns: columns.map((col) => ({
          name: col.name,
          type: col.type,
          nullable: col.nullable,
        })),
      };

      const res = await fetch('/api/files/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.message ?? data?.error ?? 'Error al confirmar la importación.');
      }

      onSuccess();
      handleModalClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar los datos.');
    } finally {
      setCommitting(false);
    }
  };

  const acceptedExtensions = initialType === 'excel' ? '.xlsx, .xls' : '.csv, .tsv, .txt';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-3xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 p-5 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              {initialType === 'excel' ? (
                <FileSpreadsheet className="w-5 h-5" />
              ) : (
                <FileText className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight">
                {preview ? 'Previsualización y Tipos de Columna' : 'Cargar Archivo CSV o Excel'}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {preview
                  ? 'Verificá los tipos de columna inferidos y confirmá para crear la tabla de datos.'
                  : 'Subí un archivo para tratarlo como una fuente de datos consultable vía SQL.'}
              </p>
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleModalClose}
            className="text-slate-400 hover:text-white h-8 w-8 p-0 rounded-lg"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {error && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!preview ? (
            /* Upload Step */
            <div className="space-y-4">
              <div
                role="button"
                tabIndex={0}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center cursor-pointer transition ${
                  dragOver
                    ? 'border-emerald-500 bg-emerald-500/5'
                    : 'border-slate-800 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-950/70'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  data-testid="file-input"
                  accept={acceptedExtensions}
                  onChange={handleFileChange}
                  className="hidden"
                />

                {uploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                    <p className="text-xs text-slate-300 font-medium">
                      Analizando filas e infiriendo tipos…
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 mb-1">
                      <UploadCloud className="w-6 h-6 text-emerald-400" />
                    </div>
                    <p className="text-sm font-semibold text-white">
                      Arrastrá tu archivo acá o hacé clic para seleccionar
                    </p>
                    <p className="text-xs text-slate-400 max-w-sm">
                      Soporta archivos <span className="text-slate-200">CSV, TSV (.csv, .tsv)</span> y{' '}
                      <span className="text-slate-200">Excel (.xlsx, .xls)</span> de hasta 100 MB.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Preview & Configure Step */
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 text-xs">
                <div className="space-y-1">
                  <span className="text-slate-400 text-[11px]">Archivo original:</span>
                  <p className="font-mono text-white truncate">{preview.name}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-400 text-[11px]">Formato y Filas:</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase font-bold text-emerald-400 border-emerald-500/30">
                      {preview.format}
                    </Badge>
                    <span className="text-slate-300 font-mono">
                      {preview.totalRows.toLocaleString('es-CL')} filas
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-400 text-[11px]">Tamaño:</span>
                  <p className="text-slate-300 font-mono">
                    {(preview.sizeBytes / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-300">Nombre descriptivo de la fuente</Label>
                <Input
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                  className="bg-slate-950 border-slate-800 text-xs"
                  placeholder="Ej: Reporte de Ventas 2026"
                />
              </div>

              {/* Column Types Config */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-300">
                    Definición de Columnas ({columns.length})
                  </Label>
                  <span className="text-[11px] text-slate-500">
                    Tipos inferidos automáticamente — podés modificarlos si corresponde.
                  </span>
                </div>

                <div className="max-h-48 overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800/60 bg-slate-950/40">
                  {columns.map((col, idx) => (
                    <div
                      key={col.name}
                      className="p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono font-medium text-slate-200 truncate">
                          {col.name}
                        </span>
                        {col.samples?.length > 0 && (
                          <span className="text-[11px] text-slate-500 truncate max-w-[200px]">
                            (Ej: {String(col.samples[0])})
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <select
                          data-testid={`column-type-${col.name}`}
                          value={col.type}
                          aria-label={`Tipo de dato para columna ${col.name}`}
                          onChange={(e) =>
                            handleColumnTypeChange(idx, e.target.value as ColumnType)
                          }
                          className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2.5 py-1 focus:outline-none focus:border-indigo-500"
                        >
                          <option value="string">string (Texto)</option>
                          <option value="number">number (Numérico)</option>
                          <option value="date">date (Fecha)</option>
                          <option value="boolean">boolean (Booleano)</option>
                          <option value="json">json (Objeto)</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Data Preview Table */}
              {preview.previewRows?.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <TableIcon className="w-3.5 h-3.5" />
                    <span>Previsualización de datos (primeras filas)</span>
                  </div>
                  <div className="overflow-x-auto max-h-36 border border-slate-800 rounded-lg bg-slate-950/60 text-xs">
                    <table className="w-full text-left font-mono">
                      <thead className="bg-slate-900 border-b border-slate-800 text-[11px] text-slate-400">
                        <tr>
                          {columns.map((col) => (
                            <th key={col.name} className="px-3 py-1.5 font-semibold">
                              {col.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50 text-[11px] text-slate-300">
                        {preview.previewRows.map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-slate-900/40">
                            {columns.map((col) => (
                              <td key={col.name} className="px-3 py-1 truncate max-w-xs">
                                {row[col.name] !== null && row[col.name] !== undefined
                                  ? String(row[col.name])
                                  : '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 p-4 bg-slate-900/80 flex items-center justify-between">
          {preview ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={committing}
              className="text-xs text-slate-400 hover:text-white gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Cambiar archivo</span>
            </Button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleModalClose}
              disabled={uploading || committing}
              className="text-xs text-slate-400"
            >
              Cancelar
            </Button>

            {preview && (
              <Button
                type="button"
                size="sm"
                onClick={handleCommit}
                disabled={committing}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium gap-1.5 shadow-lg shadow-emerald-500/20"
              >
                {committing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Creando tabla…</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Confirmar e Importar</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
