'use client';

import { AuditPanel } from '@/components/audit/AuditPanel';

export default function AuditPage() {
  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Registro de acciones realizadas por usuarios de tu organización. Solo visible para admins.
        </p>
      </header>
      <AuditPanel />
    </div>
  );
}