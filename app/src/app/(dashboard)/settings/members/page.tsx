import Link from 'next/link';
import { ArrowLeft, Users } from 'lucide-react';
import { MembersManager } from '@/components/settings/MembersManager';

export const metadata = {
  title: 'Gestión de Miembros | dash-bi',
  description: 'Administración de usuarios, roles y control de acceso (RBAC)',
};

export default function MembersSettingsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Volver a Configuración</span>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-400" />
            <span>Miembros y Roles</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Administrá el acceso a la organización y los permisos granulares (Admin, Editor, Viewer).
          </p>
        </div>
      </div>

      <MembersManager />
    </div>
  );
}
