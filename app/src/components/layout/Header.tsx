"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, Moon, Search, Sun, User } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { OrgSwitcher } from "@/components/org/OrgSwitcher";
import { signOut, useSession } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

const pageLabels: Record<string, string> = {
  "/dashboards": "Dashboards",
  "/reports": "Reportes",
  "/data-sources": "Fuentes de datos",
  "/settings": "Configuración",
};

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const { toast } = useToast();
  const { toggleSidebar, activeMode, setActiveMode } = useUIStore();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleSignOut = async () => {
    try {
      await signOut();
      toast({
        title: "Sesión cerrada",
        description: "Volvemos a la pantalla de inicio.",
      });
      router.push("/login");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Error al cerrar sesión";
      toast({
        variant: "destructive",
        title: "No pudimos cerrar sesión",
        description: message,
      });
    }
  };

  const currentPage =
    Object.entries(pageLabels).find(
      ([path]) => pathname === path || pathname.startsWith(`${path}/`),
    )?.[1] ?? "Workspace";
  const userName = session?.user?.name || "Usuario";

  return (
    <header className="platform-header">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="platform-header__menu"
          aria-label="Alternar navegación"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <OrgSwitcher />
        <span className="platform-header__divider" aria-hidden="true">
          /
        </span>
        <span className="platform-header__page" aria-current="page">
          {currentPage}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="platform-header__search"
          onClick={() => router.push("/dashboards")}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          <span>Buscar</span>
          <kbd>⌘ K</kbd>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="platform-header__icon"
              aria-label="Cambiar apariencia"
            >
              {activeMode === "dark" ? (
                <Moon className="h-4 w-4" />
              ) : (
                <Sun className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Apariencia</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setActiveMode("light")}>
              <Sun className="h-4 w-4" /> Claro
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setActiveMode("dark")}>
              <Moon className="h-4 w-4" /> Oscuro
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setActiveMode("system")}>
              <span className="h-4 w-4 text-center text-xs">A</span> Sistema
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="relative">
          <button
            onClick={() => setUserMenuOpen((open) => !open)}
            aria-label="Menú de usuario"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            className="platform-user-button"
          >
            <span className="platform-user-button__avatar">
              {userName[0]?.toUpperCase() || <User className="h-4 w-4" />}
            </span>
            <span className="hidden max-w-28 truncate text-left text-sm font-medium md:block">
              {userName}
            </span>
          </button>

          {userMenuOpen && (
            <>
              <button
                type="button"
                aria-label="Cerrar menú de usuario"
                tabIndex={-1}
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setUserMenuOpen(false)}
              />
              <div className="platform-user-menu">
                <div className="border-b border-border px-3 py-2">
                  <p className="truncate text-sm font-semibold">{userName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {session?.user?.email || "usuario@dash-bi.local"}
                  </p>
                </div>
                <button
                  onClick={handleSignOut}
                  className="platform-user-menu__signout"
                >
                  <LogOut className="h-4 w-4" /> Cerrar sesión
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
