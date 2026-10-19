/**
 * Role-based permissions. Pure functions – shared by server code and tests.
 * Humans hold canon authority: only roles with `canon:approve` can make
 * anything official, unlock a character or approve deliverables.
 */
export const ROLES = ["owner", "creative_director", "producer", "contributor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "org:manage",
  "members:manage",
  "providers:manage",
  "audit:read",
  "data:delete",
  "canon:edit",
  "canon:approve",
  "character:lock",
  "reference:upload",
  "reference:classify",
  "production:create",
  "production:run",
  "review:comment",
  "review:approve",
  "budget:approve",
  "export:create",
  "outreach:approve",
  "publish:approve",
  "analytics:import",
  "workflow:edit",
  "agents:edit",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

const MATRIX: Record<Role, Set<Permission>> = {
  owner: ALL,
  creative_director: new Set<Permission>([
    "audit:read",
    "canon:edit",
    "canon:approve",
    "character:lock",
    "reference:upload",
    "reference:classify",
    "production:create",
    "production:run",
    "review:comment",
    "review:approve",
    "budget:approve",
    "export:create",
    "outreach:approve",
    "publish:approve",
    "analytics:import",
    "workflow:edit",
    "agents:edit",
  ]),
  producer: new Set<Permission>(["canon:edit", "reference:upload", "production:create", "production:run", "review:comment", "export:create", "analytics:import", "workflow:edit"]),
  contributor: new Set<Permission>(["reference:upload", "review:comment", "canon:edit"]),
  viewer: new Set<Permission>([]),
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  creative_director: "Creative Director",
  producer: "Producer",
  contributor: "Contributor",
  viewer: "Viewer",
};

export function isRole(r: string): r is Role {
  return (ROLES as readonly string[]).includes(r);
}

export function can(role: string, permission: Permission): boolean {
  return isRole(role) && MATRIX[role].has(permission);
}

export function permissionsFor(role: string): Permission[] {
  return isRole(role) ? [...MATRIX[role]] : [];
}
