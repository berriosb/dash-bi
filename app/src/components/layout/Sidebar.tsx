'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronRight, CircleHelp } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/cn';
import { getActiveNavigationHref, platformNavigation } from './navigation';

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { sidebarOpen } = useUIStore();

  if (!sidebarOpen) return null;

  const activeHref = getActiveNavigationHref(pathname, searchParams.toString());

  return (
    <aside className="platform-sidebar" aria-label="Navegación principal">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="platform-sidebar__brand">
          <Link href="/dashboards" className="platform-brand" aria-label="dash-bi, ir a dashboards">
            <span className="platform-brand__mark" aria-hidden="true">db</span>
            <span className="platform-brand__name">dash-bi</span>
          </Link>
          <span className="platform-sidebar__workspace">Workspace de análisis</span>
        </div>

        <nav className="platform-sidebar__nav">
          {platformNavigation.map((section) => (
            <div key={section.label} className="platform-nav-section">
              <p className="platform-nav-section__label">{section.label}</p>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeHref === item.href;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn('platform-nav-item', active && 'platform-nav-item--active')}
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{item.label}</span>
                      {active && <ChevronRight className="ml-auto h-3.5 w-3.5" aria-hidden="true" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      <div className="platform-sidebar__footer">
        <Link href="/onboarding" className="platform-sidebar__help">
          <CircleHelp className="h-4 w-4" aria-hidden="true" />
          <span>Guía de inicio</span>
        </Link>
        <p className="platform-sidebar__version">dash-bi · self-hosted BI</p>
      </div>
    </aside>
  );
}
