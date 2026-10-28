'use client';

import { useQuery } from '@tanstack/react-query';
import { useUIStore } from '@/stores/uiStore';
import type { OrgRole } from '@/lib/auth/permissions';

/**
 * The role of the user in the ACTIVE organization.
 *
 * ## Why this exists
 *
 * `export.pdf` is an editor capability: the backend answers 403 to a viewer
 * (`app/src/app/api/dashboards/[id]/export/pdf/route.ts` → `requireAuth(req,
 * 'export.pdf')`). The UI rendered the export button for every role anyway,
 * so a viewer found out about the permission by clicking it and reading the
 * error. This hook is how the UI learns the role to hide the control.
 *
 * ## Where the data comes from
 *
 * `GET /api/organizations` already returns the caller's role per org
 * (`app/src/app/api/organizations/route.ts`). It is fetched under the query
 * key `["my-orgs"]`, the SAME key the `OrgSwitcher` in the header uses, so
 * on a dashboard page the data is already in the TanStack Query cache when
 * this hook mounts: no extra request, and the role is known on the first
 * render.
 *
 * `role === null` means "unknown": no session (the public demo), or the
 * request failed. It does NOT mean "viewer".
 */
export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: OrgRole;
}

interface MyOrgsResponse {
  organizations: OrgSummary[];
  activeOrgId: string;
}

async function fetchMyOrgs(): Promise<MyOrgsResponse> {
  const res = await fetch('/api/organizations');
  if (!res.ok) throw new Error('No pudimos cargar las organizaciones.');
  return res.json() as Promise<MyOrgsResponse>;
}

export function useActiveOrgRole(): { role: OrgRole | null; isLoading: boolean } {
  const activeOrgId = useUIStore((state) => state.activeOrgId);

  const { data, isLoading } = useQuery({
    queryKey: ['my-orgs'],
    queryFn: fetchMyOrgs,
    staleTime: 60_000,
  });

  const organizations = data?.organizations ?? [];
  const current =
    organizations.find((org) => org.id === (activeOrgId ?? data?.activeOrgId)) ??
    organizations[0];

  return { role: current?.role ?? null, isLoading };
}
