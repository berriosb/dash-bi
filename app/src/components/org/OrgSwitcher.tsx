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
        className="flex items-center gap-2.5 px-3 py-1.5 h-10 rounded-lg hover:bg-slate-800 text-slate-200 border border-slate-800/80 bg-slate-900/50"
      >
        <div className="w-6 h-6 rounded-md bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-bold text-xs">
          <Building2 className="w-3.5 h-3.5" />
        </div>
        <div className="flex flex-col text-left">
          <span className="text-xs font-semibold text-white leading-tight truncate max-w-[130px]">
            {currentOrg.name}
          </span>
          <span className="text-[10px] text-indigo-400 font-medium tracking-wide uppercase">
            Plan {currentOrg.plan}
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
          <div className="absolute left-0 mt-2 w-56 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-1.5 z-50 space-y-1 text-slate-200 animate-in fade-in zoom-in-95">
            <div className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              Organizaciones
            </div>
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium bg-slate-800/50 text-left">
              <div className="w-5 h-5 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px]">
                🏢
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