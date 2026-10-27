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
