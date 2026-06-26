export const PROJECT_ROLE_VALUES = ['manager', 'member', 'viewer'] as const

export type NormalizedProjectRole = typeof PROJECT_ROLE_VALUES[number]

export const PROJECT_ROLE_LABELS: Record<NormalizedProjectRole, string> = {
  manager: '管理者',
  member: '成员',
  viewer: '观察者'
}

export const PROJECT_ROLE_COLORS: Record<NormalizedProjectRole, string> = {
  manager: 'primary',
  member: 'success',
  viewer: 'neutral'
}

export const PROJECT_ROLE_OPTIONS = PROJECT_ROLE_VALUES.map(value => ({
  value,
  label: PROJECT_ROLE_LABELS[value]
}))

export function normalizeProjectRole(role: string | null | undefined): NormalizedProjectRole {
  if (role === 'manager') return 'manager'
  if (role === 'viewer') return 'viewer'
  return 'member'
}
