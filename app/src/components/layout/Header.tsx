'use client';

import { useUIStore } from '@/stores/uiStore';
import { OrgSwitcher } from '@/components/org/OrgSwitcher';
import { signOut, useSession } from '@/lib/auth/client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Menu, LogOut, Sparkles, User, Palette } from 'lucide-react';
import { useState } from 'react';

export function Header() {
  const router = useRouter();
  const { data: session } = useSession();
  const { toggleSidebar, activeTheme, setActiveTheme } = useUIStore();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  return (
    <header className="h-16 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md px-4 flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <Menu className="w-5 h-5" />
        </Button>

        <OrgSwitcher />
      </div>

      <div className="flex items-center gap-3">
        {/* Theme Switcher Toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActiveTheme(activeTheme === 'moderno-saas' ? 'corporate' : 'moderno-saas')}
          className="hidden md:flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:bg-slate-800 px-3 h-8 rounded-full"
        >
          <Palette className="w-3.5 h-3.5 text-indigo-400" />
          <span>Tema: {activeTheme === 'moderno-saas' ? 'Moderno' : 'Corporate'}</span>
        </Button>

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
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
