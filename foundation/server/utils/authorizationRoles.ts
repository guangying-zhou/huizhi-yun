import { isEnterpriseRole as coreIsEnterpriseRole } from '@hzy/authz-core'

type RoleRecord = Record<string, unknown>

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function field(record: RoleRecord, camelKey: string, snakeKey: string) {
  return record[camelKey] ?? record[snakeKey]
}

export function isEnterpriseRoleRecord(role: RoleRecord | null | undefined) {
  if (!role) return false

  return coreIsEnterpriseRole({
    appCode: stringValue(field(role, 'appCode', 'app_code')) || null,
    status: stringValue(role.status) || 'active',
    isAssignable: field(role, 'isAssignable', 'is_assignable') as boolean | number | string | null | undefined
  })
}
