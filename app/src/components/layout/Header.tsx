'use client';

import { useUIStore } from '@/stores/uiStore';
import { OrgSwitcher } from '@/components/org/OrgSwitcher';
import { signOut, useSession } from '@/lib/auth/client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Menu, LogOut, User, Palette, Sun, Moon, Monitor } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';

export function Header() {
  const router = useRouter();
  const { data: session } = useSession();
  const { toast } = useToast();
  const {
    toggleSidebar,
    activeTheme,
    setActiveTheme,
    activeMode,
    setActiveMode,
  } = useUIStore();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleSignOut = async () => {
    try {
      await signOut();
      toast({ title: 'Sesión cerrada', description: 'Volvemos a la pantalla de inicio.' });
      router.push('/login');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al cerrar sesión';
      toast({ variant: 'destructive', title: 'No pudimos cerrar sesión', description: message });
    }
  };

  return (
    <header className="h-16 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md px-4 flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="text-slate-400 hover:text-white hover:bg-slate-800"
          aria-label="Alternar sidebar"
        >
          <Menu className="w-5 h-5" />
        </Button>

        <OrgSwitcher />
      </div>

      <div className="flex items-center gap-2">
        {/* Theme + Mode dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="hidden md:flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:bg-slate-800 px-3 h-8 rounded-full"
              aria-label="Cambiar tema"
            >
              <Palette className="w-3.5 h-3.5 text-indigo-400" />
              <span>{activeTheme === 'moderno-saas' ? 'Moderno' : 'Corporate'}</span>
              <span className="text-slate-500">·</span>
              {activeMode === 'dark' ? (
                <Moon className="w-3.5 h-3.5 text-slate-400" />
              ) : activeMode === 'light' ? (
                <Sun className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Monitor className="w-3.5 h-3.5 text-slate-400" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-slate-900 border-slate-800 text-slate-200">
            <DropdownMenuLabel>Tema visual</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => {
                setActiveTheme('moderno-saas');
                toast({ title: 'Tema Moderno SaaS' });
              }}
              className={activeTheme === 'moderno-saas' ? 'bg-slate-800 text-white' : ''}
            >
              <Palette className="w-4 h-4 mr-2 text-indigo-400" />
              Moderno SaaS
              {activeTheme === 'moderno-saas' && <span className="ml-auto text-indigo-400">✓</span>}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setActiveTheme('corporate');
                toast({ title: 'Tema Corporate' });
              }}
              className={activeTheme === 'corporate' ? 'bg-slate-800 text-white' : ''}
            >
              <Palette className="w-4 h-4 mr-2 text-blue-400" />
              Corporate
              {activeTheme === 'corporate' && <span className="ml-auto text-blue-400">✓</span>}
            </DropdownMenuItem>

            <DropdownMenuSeparator className="bg-slate-800" />
            <DropdownMenuLabel>Modo</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setActiveMode('light')} className={activeMode === 'light' ? 'bg-slate-800 text-white' : ''}>
              <Sun className="w-4 h-4 mr-2 text-amber-400" />
              Claro
              {activeMode === 'light' && <span className="ml-auto text-amber-400">✓</span>}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveMode('dark')} className={activeMode === 'dark' ? 'bg-slate-800 text-white' : ''}>
              <Moon className="w-4 h-4 mr-2 text-slate-300" />
              Oscuro
              {activeMode === 'dark' && <span className="ml-auto text-slate-300">✓</span>}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveMode('system')} className={activeMode === 'system' ? 'bg-slate-800 text-white' : ''}>
              <Monitor className="w-4 h-4 mr-2 text-slate-400" />
              Sistema
              {activeMode === 'system' && <span className="ml-auto text-slate-400">✓</span>}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            aria-label="Menú de usuario"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            className="flex items-center gap-2.5 p-1 rounded-full hover:bg-slate-800 border border-slate-800 bg-slate-900/60 transition"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shadow-sm">
              {session?.user?.name?.[0]?.toUpperCase() || <User className="w-4 h-4" />}
            </div>
          </button>

          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
              <div className="absolute right-0 mt-2 w-56 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-2 z-50 space-y-1 text-slate-200 animate-in fade-in zoom-in-95">
                <div className="px-3 py-2 border-b border-slate-800">
                  <p className="text-xs font-semibold text-white truncate">
                    {session?.user?.name || 'Usuario'}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {session?.user?.email || 'usuario@dash-bi.local'}
                  </p>
                </div>

                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-rose-400 hover:bg-rose-500/10 text-left transition"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Cerrar sesión</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
