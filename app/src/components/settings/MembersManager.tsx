'use client';

import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Users,
  UserPlus,
  Shield,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  ChevronDown,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type OrgRole = 'admin' | 'editor' | 'viewer';

export interface OrgMember {
  id: string;
  userId: string;
  role: OrgRole;
  joinedAt: string | null;
  invitedAt: string;
  createdAt: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

const ROLE_LABELS: Record<OrgRole, { label: string; description: string; variant: 'default' | 'outline' | 'secondary' }> = {
  admin: {
    label: 'Admin',
    description: 'Acceso total a configuración, fuentes, dashboards y miembros.',
    variant: 'default',
  },
  editor: {
    label: 'Editor',
    description: 'Puede crear y modificar dashboards, fuentes y alertas.',
    variant: 'secondary',
  },
  viewer: {
    label: 'Viewer',
    description: 'Solo lectura de dashboards autorizados y exports.',
    variant: 'outline',
  },
};

export function MembersManager() {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<OrgRole>('viewer');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite modal state
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('editor');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Mutation in-flight tracking
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/organizations/members');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Error al cargar miembros (HTTP ${res.status})`);
      }
      const data = (await res.json()) as {
        members: OrgMember[];
        currentUserId: string;
        currentUserRole: OrgRole;
      };
      setMembers(data.members ?? []);
      setCurrentUserId(data.currentUserId);
      setCurrentUserRole(data.currentUserRole);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMembers();
  }, [fetchMembers]);

  const showNotification = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setInviting(true);
    setInviteError(null);

    try {
      const res = await fetch('/api/organizations/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        member?: OrgMember;
        message?: string;
      };

      if (!res.ok) {
        throw new Error(body.message ?? 'No se pudo invitar al miembro');
      }

      setIsInviteOpen(false);
      setInviteEmail('');
      setInviteRole('editor');
      showNotification(`Invitación enviada a ${inviteEmail.trim()}`);
      void fetchMembers();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Error al invitar');
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: OrgRole) => {
    setActionLoadingId(memberId);
    try {
      const res = await fetch(`/api/organizations/members/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        throw new Error(body.message ?? 'No se pudo actualizar el rol');
      }

      showNotification('Rol actualizado correctamente');
      void fetchMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar el rol');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRemoveMember = async (member: OrgMember) => {
    const isSelf = member.userId === currentUserId;
    const confirmText = isSelf
      ? '¿Estás seguro de que deseás abandonar esta organización?'
      : `¿Estás seguro de que deseás remover a ${member.name ?? member.email} de la organización?`;

    if (!window.confirm(confirmText)) return;

    setActionLoadingId(member.id);
    try {
      const res = await fetch(`/api/organizations/members/${member.id}`, {
        method: 'DELETE',
      });

      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        throw new Error(body.message ?? 'No se pudo remover al miembro');
      }

      showNotification('Miembro removido de la organización');
      void fetchMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al remover miembro');
    } finally {
      setActionLoadingId(null);
    }
  };

  const isAdmin = currentUserRole === 'admin';

  return (
    <Card className="bg-slate-900/70 border-slate-800 text-white shadow-xl">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800/60 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-400" />
            <CardTitle className="text-base font-bold">Miembros del Equipo (RBAC)</CardTitle>
          </div>
          <CardDescription className="text-xs text-slate-400 mt-1">
            Gestioná el acceso, invitá colaboradores y definí permisos según sus roles.
          </CardDescription>
        </div>

        {isAdmin && (
          <Button
            size="sm"
            onClick={() => {
              setInviteError(null);
              setIsInviteOpen(true);
            }}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs gap-1.5 shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            <span>Invitar Miembro</span>
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4 pt-5">
        {successMessage && (
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2 animate-in fade-in duration-200">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2 animate-in fade-in duration-200">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
            <p className="text-xs">Cargando miembros de la organización…</p>
          </div>
        ) : members.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs">
            No se encontraron miembros en esta organización.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
            {members.map((member) => {
              const isSelf = member.userId === currentUserId;
              const isMutating = actionLoadingId === member.id;
              const initial = (member.name || member.email || '?')[0]!.toUpperCase();

              return (
                <div
                  key={member.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-4 hover:bg-slate-900/40 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 shadow-inner ${
                        member.role === 'admin'
                          ? 'bg-indigo-600 text-white'
                          : member.role === 'editor'
                            ? 'bg-purple-600 text-white'
                            : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {initial}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-xs text-white truncate">
                          {member.name || member.email.split('@')[0]}
                        </p>
                        {isSelf && (
                          <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">
                            Tú
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">{member.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    {/* Role selector dropdown for Admins or static badge */}
                    {isAdmin ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isMutating}
                            className="h-8 gap-1.5 border-slate-800 bg-slate-900 hover:bg-slate-800 text-xs"
                          >
                            <Shield className="w-3.5 h-3.5 text-indigo-400" />
                            <span>{ROLE_LABELS[member.role]?.label ?? member.role}</span>
                            <ChevronDown className="w-3 h-3 text-slate-400" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 bg-slate-900 border-slate-800 text-white">
                          <DropdownMenuItem
                            onClick={() => void handleRoleChange(member.id, 'admin')}
                            className="flex flex-col items-start gap-0.5 cursor-pointer text-xs focus:bg-slate-800"
                          >
                            <span className="font-bold text-indigo-300">Admin</span>
                            <span className="text-[10px] text-slate-400">Acceso total</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => void handleRoleChange(member.id, 'editor')}
                            className="flex flex-col items-start gap-0.5 cursor-pointer text-xs focus:bg-slate-800"
                          >
                            <span className="font-bold text-purple-300">Editor</span>
                            <span className="text-[10px] text-slate-400">Crear y editar dashboards</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => void handleRoleChange(member.id, 'viewer')}
                            className="flex flex-col items-start gap-0.5 cursor-pointer text-xs focus:bg-slate-800"
                          >
                            <span className="font-bold text-slate-300">Viewer</span>
                            <span className="text-[10px] text-slate-400">Solo lectura</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <Badge
                        variant={ROLE_LABELS[member.role]?.variant ?? 'outline'}
                        className="text-[10px] capitalize px-2 py-0.5"
                      >
                        {ROLE_LABELS[member.role]?.label ?? member.role}
                      </Badge>
                    )}

                    {/* Delete member button */}
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isMutating}
                        onClick={() => void handleRemoveMember(member)}
                        className="h-8 w-8 p-0 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        title={isSelf ? 'Abandonar organización' : 'Remover miembro'}
                        aria-label={`Remover miembro ${member.email}`}
                      >
                        {isMutating ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Invite Member Modal */}
      {isInviteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl p-6 text-white space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-indigo-400" />
                <h3 id="invite-modal-title" className="text-base font-bold">
                  Invitar nuevo miembro
                </h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsInviteOpen(false)}
                className="h-8 w-8 p-0 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {inviteError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{inviteError}</span>
              </div>
            )}

            <form onSubmit={handleInvite} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="invite-email" className="text-xs text-slate-300">
                  Correo Electrónico
                </Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  placeholder="colega@tuempresa.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="bg-slate-950 border-slate-800 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-300">Rol Asignado</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(['admin', 'editor', 'viewer'] as const).map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setInviteRole(role)}
                      className={`p-2.5 rounded-lg border flex flex-col items-center gap-1 text-xs font-semibold transition ${
                        inviteRole === role
                          ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <span className="capitalize">{role}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  {ROLE_LABELS[inviteRole]?.description}
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsInviteOpen(false)}
                  disabled={inviting}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={inviting || !inviteEmail.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs gap-1.5"
                >
                  {inviting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Invitando…</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Enviar Invitación</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Card>
  );
}
