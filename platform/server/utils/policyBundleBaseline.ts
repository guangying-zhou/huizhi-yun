import type { RowDataPacket } from 'mysql2/promise'

export interface BaselinePermission {
  appCode: string
  resourceCode: string
  action: string
  scopeType: string
  scopeValue: string
  description?: string | null
  excludedSubjectCodes?: string[]
}

interface BaselinePermissionRow extends RowDataPacket {
  id: number
  app_code: string
  resource_code: string
  action: string
  scope_type: string
  scope_value: string
  description: string | null
  sort_order: number
}

interface BaselineExcludedSubjectRow extends RowDataPacket {
  subject_code: string
}

export interface BaselineQueryAdapter {
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
}

// Baseline permissions are employee self-service defaults. Console and Assets
// access must come from explicit tenant roles/templates.
export const BASELINE_PERMISSIONS: BaselinePermission[] = [
  { appCode: 'workflow', resourceCode: 'workflow_workspace', action: 'view', scopeType: 'subject', scopeValue: 'self' },
  { appCode: 'workflow', resourceCode: 'workflow_tasks', action: 'view', scopeType: 'relation', scopeValue: 'assigned' },
  { appCode: 'workflow', resourceCode: 'workflow_tasks', action: 'edit', scopeType: 'relation', scopeValue: 'assigned' },
  { appCode: 'workflow', resourceCode: 'workflow_instances', action: 'view', scopeType: 'subject', scopeValue: 'self' },
  { appCode: 'codocs', resourceCode: 'documents', action: 'view', scopeType: 'relation', scopeValue: 'owned_or_shared' },
  { appCode: 'codocs', resourceCode: 'documents', action: 'create', scopeType: 'subject', scopeValue: 'self' },
  { appCode: 'codocs', resourceCode: 'documents', action: 'edit', scopeType: 'relation', scopeValue: 'owned_or_shared' },
  { appCode: 'codocs', resourceCode: 'documents', action: 'delete', scopeType: 'relation', scopeValue: 'owned_or_shared' },
  { appCode: 'codocs', resourceCode: 'departments', action: 'view', scopeType: 'relation', scopeValue: 'member_department' },
  { appCode: 'codocs', resourceCode: 'departments', action: 'create', scopeType: 'relation', scopeValue: 'member_department' },
  { appCode: 'codocs', resourceCode: 'departments', action: 'edit', scopeType: 'relation', scopeValue: 'member_department' },
  { appCode: 'codocs', resourceCode: 'company', action: 'view', scopeType: 'tenant', scopeValue: 'published' },
  { appCode: 'codocs', resourceCode: 'info', action: 'view', scopeType: 'tenant', scopeValue: 'published' },
  { appCode: 'codocs', resourceCode: 'reviews', action: 'view', scopeType: 'relation', scopeValue: 'participant' },
  { appCode: 'codocs', resourceCode: 'reviews', action: 'submit', scopeType: 'subject', scopeValue: 'self' },
  { appCode: 'aims', resourceCode: 'aims_overview', action: 'view', scopeType: 'relation', scopeValue: 'participant' },
  { appCode: 'aims', resourceCode: 'projects', action: 'view', scopeType: 'relation', scopeValue: 'participant' },
  { appCode: 'aims', resourceCode: 'work_items', action: 'view', scopeType: 'relation', scopeValue: 'participant' },
  { appCode: 'aims', resourceCode: 'notifications', action: 'view', scopeType: 'subject', scopeValue: 'self' }
]

export function collectBaselinePermissions(appCodes: string[]) {
  const appCodeSet = new Set(appCodes)
  return BASELINE_PERMISSIONS
    .filter(permission => appCodeSet.has(permission.appCode))
    .map(permission => ({ ...permission }))
}

export function baselinePermissionKey(permission: Pick<BaselinePermission, 'appCode' | 'resourceCode' | 'action' | 'scopeType' | 'scopeValue'>) {
  return [
    permission.appCode,
    permission.resourceCode,
    permission.action,
    permission.scopeType,
    permission.scopeValue
  ].join(':')
}

export function baselinePermissionExcludesSubject(permission: BaselinePermission, subjectCode: string) {
  const normalizedSubjectCode = String(subjectCode || '').trim()
  if (!normalizedSubjectCode) return false

  return (permission.excludedSubjectCodes || [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .includes(normalizedSubjectCode)
}

export function isMissingBaselineGovernanceTableError(error: unknown) {
  const err = error as { code?: string, errno?: number, message?: string }
  const message = String(err?.message || '')
  return err?.code === 'ER_NO_SUCH_TABLE'
    || err?.errno === 1146
    || message.includes('platform_baseline_permissions')
    || message.includes('platform_baseline_excluded_subjects')
}

function baselinePermissionsFromRows(rows: BaselinePermissionRow[], excludedSubjectCodes: string[]) {
  return rows.map(row => ({
    appCode: row.app_code,
    resourceCode: row.resource_code,
    action: row.action,
    scopeType: row.scope_type,
    scopeValue: row.scope_value,
    description: row.description,
    excludedSubjectCodes: [...excludedSubjectCodes]
  }))
}

function appCodeFilter(appCodes?: string[]) {
  const uniqueAppCodes = [...new Set((appCodes || []).map(item => String(item || '').trim()).filter(Boolean))]
  if (appCodes && uniqueAppCodes.length === 0) {
    return null
  }

  if (uniqueAppCodes.length === 0) {
    return { sql: '', params: [] as string[] }
  }

  return {
    sql: ` AND app_code IN (${uniqueAppCodes.map(() => '?').join(', ')})`,
    params: uniqueAppCodes
  }
}

async function loadBaselineExcludedSubjectCodes(queries: BaselineQueryAdapter) {
  try {
    const rows = await queries.queryRows<BaselineExcludedSubjectRow[]>(
      `SELECT subject_code
       FROM platform_baseline_excluded_subjects
       WHERE status = 'active'
       ORDER BY subject_code`
    )
    return rows.map(row => String(row.subject_code || '').trim()).filter(Boolean)
  } catch (error) {
    if (isMissingBaselineGovernanceTableError(error)) return []
    throw error
  }
}

export async function collectConfiguredBaselinePermissionsWithQueries(
  queries: BaselineQueryAdapter,
  appCodes?: string[]
) {
  const filter = appCodeFilter(appCodes)
  if (!filter) return []

  try {
    const rows = await queries.queryRows<BaselinePermissionRow[]>(
      `SELECT id, app_code, resource_code, action, scope_type, scope_value, description, sort_order
       FROM platform_baseline_permissions
       WHERE status = 'active'${filter.sql}
       ORDER BY sort_order ASC, app_code ASC, resource_code ASC, action ASC`,
      filter.params
    )
    const excludedSubjectCodes = await loadBaselineExcludedSubjectCodes(queries)
    return baselinePermissionsFromRows(rows, excludedSubjectCodes)
  } catch (error) {
    if (!isMissingBaselineGovernanceTableError(error)) throw error
  }

  return appCodes
    ? collectBaselinePermissions(appCodes)
    : BASELINE_PERMISSIONS.map(permission => ({ ...permission }))
}

export async function collectConfiguredBaselinePermissions(appCodes?: string[]) {
  const { queryRows } = await import('./db.ts')
  return collectConfiguredBaselinePermissionsWithQueries({ queryRows }, appCodes)
}
