'use client';

import { useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { Building2, ChevronDown, Check, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Org {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'pro' | 'enterprise';
}

const mockOrgs: Org[] = [
  { id: 'org_default', name: 'Mi Organización', slug: 'mi-org', plan: 'pro' },
  { id: 'org_acme', name: 'Acme Analytics', slug: 'acme', plan: 'enterprise' },
];

export function OrgSwitcher() {
  const { activeOrgId, setActiveOrgId } = useUIStore();
  const [open, setOpen] = useState(false);

  const currentOrg = mockOrgs.find((o) => o.id === activeOrgId) ?? mockOrgs[0]!;

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
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 mt-2 w-56 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-1.5 z-50 space-y-1 text-slate-200 animate-in fade-in zoom-in-95">
            <div className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              Organizaciones
            </div>
            {mockOrgs.map((org) => (
              <button
                key={org.id}
                onClick={() => {
                  setActiveOrgId(org.id);
                  setOpen(false);
                }}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium hover:bg-slate-800 text-left transition"
              >
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px]">
                    🏢
                  </div>
                  <span className="truncate">{org.name}</span>
                </div>
                {org.id === currentOrg.id && (
                  <Check className="w-3.5 h-3.5 text-indigo-400" />
                )}
              </button>
            ))}

            <div className="border-t border-slate-800 pt-1 mt-1">
              <button
                onClick={() => {
                  setOpen(false);
                  alert('Crear nueva organización próximamente.');
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-indigo-400 hover:bg-indigo-500/10 text-left transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nueva organización</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
