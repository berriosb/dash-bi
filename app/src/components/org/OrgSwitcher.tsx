"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUIStore } from "@/stores/uiStore";
import { Building2, ChevronDown, Check } from "lucide-react";

interface Org {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "pro" | "enterprise";
  role: "admin" | "editor" | "viewer";
}

interface OrganizationsResponse {
  organizations: Org[];
  activeOrgId: string;
}

async function fetchMyOrgs(): Promise<OrganizationsResponse> {
  const res = await fetch("/api/organizations");
  if (!res.ok) throw new Error("No pudimos cargar las organizaciones.");
  return res.json() as Promise<OrganizationsResponse>;
}

export function OrgSwitcher() {
  const { activeOrgId, setActiveOrgId } = useUIStore();
  const [open, setOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["my-orgs"],
    queryFn: fetchMyOrgs,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (data?.activeOrgId && data.activeOrgId !== activeOrgId) {
      setActiveOrgId(data.activeOrgId);
    }
  }, [activeOrgId, data?.activeOrgId, setActiveOrgId]);

  const organizations = data?.organizations ?? [];
  const currentOrg =
    organizations.find(
      (org) => org.id === (activeOrgId ?? data?.activeOrgId),
    ) ?? organizations[0];

  const handleSwitch = async (org: Org) => {
    if (org.id === currentOrg?.id) {
      setOpen(false);
      return;
    }

    setSwitchingId(org.id);
    setSwitchError(null);
    try {
      const res = await fetch("/api/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: org.id }),
      });
      if (!res.ok) throw new Error("No pudimos cambiar de organización.");
      setActiveOrgId(org.id);
      setOpen(false);
      // A tenant switch must replace every server and client cache boundary.
      // A router refresh alone leaves TanStack Query data from the old org.
      window.location.reload();
    } catch (error) {
      setSwitchError(
        error instanceof Error
          ? error.message
          : "No pudimos cambiar de organización.",
      );
    } finally {
      setSwitchingId(null);
    }
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        onClick={() => setOpen(!open)}
        className="platform-org-switcher"
      >
        <div className="platform-org-switcher__icon">
          <Building2 className="w-3.5 h-3.5" />
        </div>
        <div className="flex flex-col text-left">
          <span className="text-sm font-semibold leading-tight truncate max-w-[130px]">
            {isLoading
              ? "Cargando…"
              : (currentOrg?.name ??
                (isError ? "Organización" : "Sin organización"))}
          </span>
          <span className="text-[11px] text-muted-foreground font-medium tracking-wide">
            Workspace · Plan {currentOrg?.plan ?? "free"}
          </span>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
      </Button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Cerrar menú"
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default bg-transparent border-0 w-full h-full p-0"
            onClick={() => setOpen(false)}
          />
          <div className="platform-org-menu">
            <div className="platform-org-menu__label">Organizaciones</div>
            {switchError && (
              <div
                className="platform-org-menu__option text-destructive"
                role="alert"
              >
                {switchError}
              </div>
            )}
            {organizations.map((org) => (
              <button
                type="button"
                key={org.id}
                className="platform-org-menu__option w-full border-0 bg-transparent text-left"
                onClick={() => void handleSwitch(org)}
                disabled={switchingId !== null}
              >
                <div className="platform-org-menu__option-icon">
                  <Building2 className="h-3.5 w-3.5" />
                </div>
                <span className="truncate flex-1">{org.name}</span>
                {switchingId === org.id ? (
                  <span className="text-xs text-muted-foreground">
                    Cambiando…
                  </span>
                ) : org.id === currentOrg?.id ? (
                  <Check className="w-3.5 h-3.5 text-indigo-400" />
                ) : null}
              </button>
            ))}
            {organizations.length === 0 && (
              <div className="platform-org-menu__option text-muted-foreground">
                {isError ? "No disponible" : "Sin organizaciones"}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Local Button import to keep the file dependency-light.
import { Button } from "@/components/ui/button";
