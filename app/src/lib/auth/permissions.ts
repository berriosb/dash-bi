export type OrgRole = 'admin' | 'editor' | 'viewer';

const PERMISSIONS: Record<string, OrgRole[]> = {
  'org.invite': ['admin'],
  'org.removeMember': ['admin'],
  'org.updateBilling': ['admin'],
  'org.updateLLMConfig': ['admin'],
  
  'datasource.create': ['admin', 'editor'],
  'datasource.delete': ['admin', 'editor'],
  'datasource.view': ['admin', 'editor', 'viewer'],
  
  'dashboard.create': ['admin', 'editor'],
  'dashboard.edit': ['admin', 'editor'],
  'dashboard.delete': ['admin', 'editor'],
  'dashboard.view': ['admin', 'editor', 'viewer'],
  'dashboard.sharePublic': ['admin', 'editor'],
  
  'query.execute': ['admin', 'editor', 'viewer'],
  'export.pdf': ['admin', 'editor', 'viewer'],
};

export function hasPermission(role: OrgRole, action: string): boolean {
  return PERMISSIONS[action]?.includes(role) ?? false;
}
