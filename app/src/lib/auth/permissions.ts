export type OrgRole = "admin" | "editor" | "viewer";

const PERMISSIONS: Record<string, OrgRole[]> = {
  "org.switch": ["admin", "editor", "viewer"],
  "org.invite": ["admin"],
  "org.removeMember": ["admin"],
  "org.updateBilling": ["admin"],
  "org.updateLLMConfig": ["admin"],

  "datasource.create": ["admin", "editor"],
  "datasource.delete": ["admin", "editor"],
  "datasource.view": ["admin", "editor", "viewer"],

  "dashboard.create": ["admin", "editor"],
  "dashboard.edit": ["admin", "editor"],
  "dashboard.delete": ["admin", "editor"],
  "dashboard.view": ["admin", "editor", "viewer"],
  "dashboard.sharePublic": ["admin", "editor"],
  "dashboard.embed": ["admin", "editor"],

  "dashboard.alert": ["admin", "editor"],
  "dashboard.viewAlerts": ["admin", "editor", "viewer"],

  "query.execute": ["admin", "editor", "viewer"],
  // PDF export runs Puppeteer against a worker whose BullMQ limiter is
  // GLOBAL: a read-only account that can enqueue a render can starve every
  // other tenant. Exporting is an editor capability.
  "export.pdf": ["admin", "editor"],

  "audit.read": ["admin"],
};

export function hasPermission(role: OrgRole, action: string): boolean {
  return PERMISSIONS[action]?.includes(role) ?? false;
}

/**
 * Whether the UI should offer the export/share control.
 *
 * The backend already answers 403 for a viewer (`export.pdf` is an editor
 * capability). This is the other half: the button used to be rendered for
 * every role, so a viewer discovered the permission the hard way — by
 * clicking and reading the error.
 *
 * `role === null` means "the role is not known": no session, or the orgs
 * query has not resolved. The affordance is kept in that case (the public
 * demo has no session and the API answers 401 anyway) — a role that is
 * KNOWN to be insufficient is what gets hidden.
 */
export function canExportPdf(role: OrgRole | null): boolean {
  if (role === null) return true;
  return hasPermission(role, 'export.pdf');
}
