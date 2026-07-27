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
import { useToast } from '@/hooks/use-toast';

const THEME_OPTIONS: Array<{ id: ThemeId; label: string; description: string }> = [
  { id: 'moderno-saas', label: 'Moderno SaaS', description: 'Estilo Linear / Vercel, colores vibrantes.' },
  { id: 'corporate', label: 'Corporate', description: 'Formal, Bloomberg style, neutros.' },
];

const ARCHETYPE_OPTIONS: Array<{ id: ArchetypeId; label: string; description: string }> = [
  { id: 'kpi-grid', label: 'Vista general', description: 'Cuadrícula de KPIs destacados.' },
  { id: 'hero-focus', label: 'Métrica destacada', description: 'Una métrica principal grande + soporte.' },
  { id: 'executive-summary', label: 'Resumen ejecutivo', description: 'KPIs + gráficos de tendencia.' },
  { id: 'finance-report', label: 'Reporte financiero', description: 'Tablas + totales.' },
  { id: 'sales-pipeline', label: 'Pipeline comercial', description: 'Embudo + conversión.' },
  { id: 'cohort-matrix', label: 'Análisis de cohortes', description: 'Heatmap de retención.' },
  { id: 'operations-live', label: 'Monitoreo operativo', description: 'Live, alertas, contadores.' },
  { id: 'growth-metrics', label: 'Métricas de crecimiento', description: 'Curva, activación, retención.' },
  { id: 'custom', label: 'Composición personalizada', description: 'Mantener layout actual.' },
];

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
            <Palette className="w-3.5 h-3.5 text-purple-400" />
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
                {theme === opt.id && <Check className="w-3.5 h-3.5 ml-auto text-emerald-400" />}
              </div>
              <span className="text-xs text-muted-foreground">{opt.description}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
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
                {archetype === opt.id && <Check className="w-3.5 h-3.5 ml-auto text-emerald-400" />}
              </div>
              <span className="text-xs text-muted-foreground">{opt.description}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}