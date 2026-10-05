import type { ProjectConfidentialityLevel, ProjectSecurityLevel } from '../types/aims'

export interface ProjectAccessControl {
  securityLevel: ProjectSecurityLevel
  confidentialityLevel: ProjectConfidentialityLevel
  accessWhitelist: string[] | null
}

export function effectiveProjectSecurityLevel(level: ProjectSecurityLevel, confidentiality: ProjectConfidentialityLevel): ProjectSecurityLevel {
  if (confidentiality === 'L3' && (level === 'company' || level === 'department')) return 'project_team'
  if (confidentiality === 'L2' && level === 'company') return 'department'
  return level
}

export function projectAccessControlPatch(original: ProjectAccessControl, draft: ProjectAccessControl) {
  const patch: Partial<ProjectAccessControl> = {}
  if (draft.securityLevel !== original.securityLevel) patch.securityLevel = draft.securityLevel
  if (draft.confidentialityLevel !== original.confidentialityLevel) patch.confidentialityLevel = draft.confidentialityLevel
  if (draft.accessWhitelist !== null && JSON.stringify(draft.accessWhitelist) !== JSON.stringify(original.accessWhitelist)) {
    patch.accessWhitelist = [...draft.accessWhitelist]
  }
  return patch
}
