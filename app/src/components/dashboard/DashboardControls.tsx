'use client';

import * as React from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Palette, Check, Sparkles } from 'lucide-react';
import type { ThemeId, ArchetypeId } from '@/lib/widgets/types';
import { ARCHETYPES } from '@/lib/widgets/archetypes';
import { useToast } from '@/hooks/use-toast';

const THEME_OPTIONS: Array<{ id: ThemeId; label: string; description: string }> = [
  { id: 'moderno-saas', label: 'Moderno SaaS', description: 'Estilo Linear / Vercel, colores vibrantes.' },
  { id: 'corporate', label: 'Corporate', description: 'Formal, Bloomberg style, neutros.' },
];

/**
 * Short Spanish labels only. The description shown under each one is read from
 * the canonical ARCHETYPES registry, so the menu can never promise a widget the
 * renderer does not build — the earlier hand-written copy described a "heatmap
 * de retención" and an "embudo" that no slot in archetypes.ts allows, and
 * WidgetRenderer only ships kpi / line / bar / pie / area / scatter / table.
 */
const ARCHETYPE_MENU: Array<{ id: ArchetypeId; label: string; description: string }> = [
  { id: 'kpi-grid', label: 'Vista general', description: '' },
  { id: 'hero-focus', label: 'Métrica destacada', description: '' },
  { id: 'executive-summary', label: 'Resumen ejecutivo', description: '' },
  { id: 'finance-report', label: 'Reporte financiero', description: '' },
  { id: 'sales-pipeline', label: 'Pipeline comercial', description: '' },
  { id: 'cohort-matrix', label: 'Análisis de cohortes', description: '' },
  { id: 'operations-live', label: 'Monitoreo operativo', description: '' },
  { id: 'growth-metrics', label: 'Métricas de crecimiento', description: '' },
  { id: 'custom', label: 'Composición personalizada', description: 'Mantener el layout actual.' },
];

const ARCHETYPE_OPTIONS: Array<{ id: ArchetypeId; label: string; description: string }> =
  ARCHETYPE_MENU.map((opt) => ({
    ...opt,
    description: opt.description || ARCHETYPES[opt.id as Exclude<ArchetypeId, 'custom'>]?.description || '',
  }));

interface DashboardControlsProps {
  theme: ThemeId;
  archetype: ArchetypeId;
  onThemeChange: (theme: ThemeId) => void;
  onArchetypeChange: (archetype: ArchetypeId) => void;
}

export function DashboardControls({
  theme,
  archetype,
  onThemeChange,
  onArchetypeChange,
}: DashboardControlsProps) {
  const { toast } = useToast();

  const handleThemeChange = (newTheme: ThemeId) => {
    onThemeChange(newTheme);
    toast({
      title: `Tema ${THEME_OPTIONS.find((t) => t.id === newTheme)?.label ?? newTheme}`,
      description: 'El cambio se ve de inmediato en todos los widgets.',
    });
  };

  const handleArchetypeChange = (newArchetype: ArchetypeId) => {
    onArchetypeChange(newArchetype);
    toast({
      title: `Disposición ${ARCHETYPE_OPTIONS.find((a) => a.id === newArchetype)?.label ?? newArchetype}`,
      description:
        newArchetype === 'custom'
          ? 'Mantuviste la disposición actual.'
          : 'Los widgets se reorganizan al patrón del archetype.',
    });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Palette className="w-3.5 h-3.5 text-secondary" />
            <span>Tema: {THEME_OPTIONS.find((t) => t.id === theme)?.label ?? theme}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Tema visual</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {THEME_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.id}
              onSelect={() => handleThemeChange(opt.id)}
              className="flex flex-col items-start gap-0.5 cursor-pointer"
            >
              <div className="flex items-center gap-2 w-full">
                <span className="font-medium">{opt.label}</span>
                {theme === opt.id && <Check className="w-3.5 h-3.5 ml-auto text-success" />}
              </div>
              <span className="text-xs text-muted-foreground">{opt.description}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-warning" />
            <span>Disposición: {ARCHETYPE_OPTIONS.find((a) => a.id === archetype)?.label ?? archetype}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Disposición del dashboard</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {ARCHETYPE_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.id}
              onSelect={() => handleArchetypeChange(opt.id)}
              className="flex flex-col items-start gap-0.5 cursor-pointer"
            >
              <div className="flex items-center gap-2 w-full">
                <span className="font-medium">{opt.label}</span>
                {archetype === opt.id && <Check className="w-3.5 h-3.5 ml-auto text-success" />}
              </div>
              <span className="text-xs text-muted-foreground">{opt.description}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}