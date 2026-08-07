'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUIStore } from '@/stores/uiStore';
import { Building2, ChevronDown, Check } from 'lucide-react';

interface Org {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'pro' | 'enterprise';
}

async function fetchMyOrgs(): Promise<Org[]> {
  // Sprint 1.5: reuses the audit endpoint to confirm there is at least
  // one org for the session. A dedicated /api/orgs/index endpoint is
  // tracked as a follow-up — for the MVP we render the current org from
  // better-auth's activeOrgId cookie + a single fallback "Mi organización"
  // when we don't have a list endpoint yet.
  const res = await fetch('/api/audit?limit=1');
  if (!res.ok) return [];
  return [];
}

export function OrgSwitcher() {
  const { activeOrgId } = useUIStore();
  const [open, setOpen] = useState(false);

  // The OrgSwitcher is a placeholder for a future real implementation.
  // Today it just shows the active org from the session cookie.
  // Calling fetchMyOrgs() here warms the React Query cache so a future
  // dedicated `/api/orgs` endpoint can plug in without UI changes.
  useQuery({ queryKey: ['my-orgs'], queryFn: fetchMyOrgs, enabled: false });

  const currentOrg: Org = {
    id: activeOrgId ?? 'default',
    name: 'Mi organización',
    slug: 'mi-org',
    plan: 'free',
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
            {currentOrg.name}
          </span>
          <span className="text-[11px] text-muted-foreground font-medium tracking-wide">
            Workspace · Plan {currentOrg.plan}
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
            <div className="platform-org-menu__label">
              Organizaciones
            </div>
            <div className="platform-org-menu__option">
              <div className="platform-org-menu__option-icon">
                <Building2 className="h-3.5 w-3.5" />
              </div>
              <span className="truncate flex-1">{currentOrg.name}</span>
              <Check className="w-3.5 h-3.5 text-indigo-400" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Local Button import to keep the file dependency-light.
import { Button } from '@/components/ui/button';
