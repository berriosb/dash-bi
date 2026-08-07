import {
  BarChart3,
  Database,
  FileText,
  LayoutDashboard,
  Settings,
  Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavigationItem {
  label: string;
  href: string;
  icon: LucideIcon;
  description?: string;
}

export interface NavigationSection {
  label: string;
  items: NavigationItem[];
}

export const platformNavigation: NavigationSection[] = [
  {
    label: 'Analizar',
    items: [
      { label: 'Dashboards', href: '/dashboards', icon: LayoutDashboard, description: 'Lee y comparte tus paneles' },
      { label: 'Preguntar a los datos', href: '/dashboards?ask=true', icon: Sparkles, description: 'Explora con lenguaje natural' },
      { label: 'Reportes', href: '/reports', icon: FileText, description: 'Exportaciones y envíos' },
    ],
  },
  {
    label: 'Preparar',
    items: [
      { label: 'Fuentes de datos', href: '/data-sources', icon: Database, description: 'Conexiones y sincronización' },
      { label: 'Plantillas', href: '/dashboards?tab=templates', icon: BarChart3, description: 'Puntos de partida por industria' },
    ],
  },
  {
    label: 'Administrar',
    items: [
      { label: 'Configuración', href: '/settings', icon: Settings, description: 'Organización, IA y auditoría' },
    ],
  },
];

function matchesQuery(href: string, search: URLSearchParams): boolean {
  const query = href.split('?')[1];
  if (!query) return false;

  const expected = new URLSearchParams(query);
  return Array.from(expected.entries()).every(([key, value]) => search.get(key) === value);
}

export function getActiveNavigationHref(pathname: string, search = ''): string | null {
  const items = platformNavigation.flatMap((section) => section.items);
  const searchParams = new URLSearchParams(search);
  const queryMatch = items.find(
    (item) => item.href.includes('?') && pathname === item.href.split('?')[0] && matchesQuery(item.href, searchParams),
  );

  if (queryMatch) return queryMatch.href;

  const match = items
    .filter((item) => {
      if (item.href.includes('?')) return false;
      const samePath = pathname === item.href || pathname.startsWith(`${item.href}/`);
      const hasQueryRoute = items.some(
        (candidate) => candidate.href.includes('?') && candidate.href.startsWith(`${item.href}?`) && matchesQuery(candidate.href, searchParams),
      );
      return samePath && !hasQueryRoute;
    })
    .sort((a, b) => b.href.length - a.href.length)[0];

  return match?.href ?? null;
}
