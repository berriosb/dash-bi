'use client';

import * as React from 'react';
import { TEMPLATE_CATALOG } from '@/lib/templates/catalog';
import type { DashboardTemplate, TemplateCategory } from '@/lib/templates/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, ShoppingCart, Megaphone, DollarSign, Activity, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  TrendingUp,
  ShoppingCart,
  Megaphone,
  DollarSign,
  Activity,
};

const CATEGORY_LABELS: Record<TemplateCategory | 'all', string> = {
  all: 'Todas las plantillas',
  saas: 'SaaS & Subscripciones',
  ecommerce: 'E-Commerce',
  marketing: 'Marketing ROI',
  finance: 'Finanzas',
  operations: 'Operaciones SLA',
};

interface TemplatePickerProps {
  onTemplateSelect?: (template: DashboardTemplate) => void;
  className?: string;
}

export function TemplatePicker({ onTemplateSelect, className = '' }: TemplatePickerProps) {
  const [selectedCategory, setSelectedCategory] = React.useState<TemplateCategory | 'all'>('all');
  const [instantiatingId, setInstantiatingId] = React.useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const filteredTemplates = React.useMemo(() => {
    if (selectedCategory === 'all') return TEMPLATE_CATALOG;
    return TEMPLATE_CATALOG.filter((t) => t.category === selectedCategory);
  }, [selectedCategory]);

  const handleInstantiate = async (template: DashboardTemplate) => {
    if (onTemplateSelect) {
      onTemplateSelect(template);
      return;
    }

    setInstantiatingId(template.id);
    try {
      const res = await fetch(`/api/dashboards/templates/${template.id}/instantiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: template.name }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Error al instanciar plantilla');
      }

      const { dashboard } = await res.json();
      toast({
        title: '¡Dashboard Creado desde Plantilla!',
        description: `Se creó "${dashboard.title}" con éxito.`,
      });
      router.push(`/dashboards/${dashboard.id}`);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error al crear dashboard',
        description: err instanceof Error ? err.message : 'Intenta nuevamente.',
      });
    } finally {
      setInstantiatingId(null);
    }
  };

  return (
    <div className={`space-y-6 ${className}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 pb-4">
        {(Object.keys(CATEGORY_LABELS) as Array<TemplateCategory | 'all'>).map((cat) => (
          <Button
            key={cat}
            variant={selectedCategory === cat ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedCategory(cat)}
            className="rounded-full text-xs"
          >
            {CATEGORY_LABELS[cat]}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTemplates.map((template) => {
          const IconComponent = ICON_MAP[template.icon] ?? Sparkles;
          const isInstantiating = instantiatingId === template.id;

          return (
            <Card
              key={template.id}
              className="flex flex-col justify-between hover:border-purple-500/50 transition-all duration-200 bg-card/60 backdrop-blur-sm border-border/60"
            >
              <CardHeader className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20">
                    <IconComponent className="w-5 h-5" />
                  </div>
                  <Badge variant="secondary" className="capitalize text-xs font-mono">
                    {template.archetype}
                  </Badge>
                </div>
                <CardTitle className="text-lg font-semibold tracking-tight">{template.name}</CardTitle>
                <CardDescription className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                  {template.description}
                </CardDescription>
              </CardHeader>

              <CardContent className="pt-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-muted-foreground uppercase font-medium tracking-wider mr-1">
                    Conectores:
                  </span>
                  {template.recommendedSourceTypes.map((source) => (
                    <Badge key={source} variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
                      {source}
                    </Badge>
                  ))}
                </div>
              </CardContent>

              <CardFooter className="pt-3 border-t border-border/40">
                <Button
                  onClick={() => handleInstantiate(template)}
                  disabled={isInstantiating}
                  className="w-full gap-2 text-xs font-medium"
                  size="sm"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {isInstantiating ? 'Creando...' : 'Usar Plantilla'}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
