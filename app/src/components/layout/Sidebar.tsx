'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUIStore } from '@/stores/uiStore';
import { LayoutDashboard, Database, Settings, Sparkles, Compass } from 'lucide-react';
import { cn } from '@/lib/cn';

const navItems = [
  { label: 'Dashboards', href: '/dashboards', icon: LayoutDashboard },
  { label: 'Fuentes de Datos', href: '/data-sources', icon: Database },
  { label: 'Configuración', href: '/settings', icon: Settings },
  { label: 'Onboarding', href: '/onboarding', icon: Compass },
];

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarOpen } = useUIStore();

  if (!sidebarOpen) return null;

  return (
    <aside className="w-64 border-r border-slate-800 bg-slate-950 flex flex-col justify-between shrink-0 select-none z-20">
      <div className="p-4 space-y-6">
        {/* Brand */}
        <Link href="/dashboards" className="flex items-center gap-2.5 px-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white text-sm shadow-md shadow-indigo-500/20">
            📊
          </div>
          <div className="flex flex-col">
            <span className="font-bold tracking-tight text-white leading-none">dash-bi</span>
            <span className="text-[10px] text-slate-500 font-medium mt-0.5">BI Platform v1.0</span>
          </div>
        </Link>

        {/* Navigation */}
        <nav className="space-y-1">
          <div className="px-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Navegación
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-150',
                  active
                    ? 'bg-indigo-600/15 text-indigo-400 border border-indigo-500/20 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900',
                )}
              >
                <Icon className={cn('w-4 h-4', active ? 'text-indigo-400' : 'text-slate-500')} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* AI Promo Banner */}
      <div className="p-4">
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/40 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
            <span>AI Dashboard Builder</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-normal">
            Escribí una instrucción en lenguaje natural y generá gráficos en segundos.
          </p>
          <Link
            href="/dashboards?create=ai"
            className="inline-flex items-center justify-center w-full py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition"
          >
            Probar Generador ✨
          </Link>
        </div>
      </div>
    </aside>
  );
}
