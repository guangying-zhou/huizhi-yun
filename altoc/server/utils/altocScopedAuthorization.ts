import type { H3Event } from 'h3'
import type { FoundationScopedAuthorizationGrant } from '@hzy/foundation/server/utils/scopeEvaluator'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { fetchDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { hasAltocGlobalAdminRole } from '~~/server/utils/globalAdminAuthorization'
import { appCode, type PermissionAction } from '~~/app/config/permissions'
import {
  buildAltocDepartmentTreeCodeIndex,
  resolveAltocDataAccessQueryFromScopedGrants,
  scopedGrantsNeedAltocDepartmentTree as scopedGrantsNeedDepartmentTree,
  type AltocDepartmentScopeTreeNode
} from './altocDataAccessScope'

type RuntimeQuery = Record<string, unknown>
type DepartmentTreeCodeIndex = Record<string, string[]>

const DEPARTMENT_TREE_CODE_INDEX_TTL_MS = 60_000

let departmentTreeCodeIndexCache: { expiresAt: number, value: DepartmentTreeCodeIndex } | null = null

type AltocConsoleAuth = {
  authenticated?: boolean
  subjectType?: string | null
  deptCode?: string | null
  deptCodes?: string[] | string | null
  claims?: Record<string, unknown> | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map(item => item.trim()).filter(Boolean)))
}

function splitCodes(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(item => splitCodes(item))
  return String(value || '')
    .split(/[,\s;]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function extractDepartmentTree(response: {
  data?: { tree?: AltocDepartmentScopeTreeNode[] } | AltocDepartmentScopeTreeNode[] | null
  tree?: AltocDepartmentScopeTreeNode[] | null
}): AltocDepartmentScopeTreeNode[] {
  if (Array.isArray(response.data)) return response.data
  if (response.data && Array.isArray(response.data.tree)) return response.data.tree
  if (Array.isArray(response.tree)) return response.tree
  return []
}

async function loadDepartmentTreeCodeIndex(): Promise<DepartmentTreeCodeIndex> {
  const now = Date.now()
  if (departmentTreeCodeIndexCache && departmentTreeCodeIndexCache.expiresAt > now) {
    return departmentTreeCodeIndexCache.value
  }

  try {
    const response = await fetchDirectoryApi<{
      code?: number
      data?: { tree?: AltocDepartmentScopeTreeNode[] } | AltocDepartmentScopeTreeNode[] | null
      tree?: AltocDepartmentScopeTreeNode[] | null
    }>('/api/v1/directory/departments')
    const value = buildAltocDepartmentTreeCodeIndex(extractDepartmentTree(response))
    departmentTreeCodeIndexCache = {
      expiresAt: now + DEPARTMENT_TREE_CODE_INDEX_TTL_MS,
      value
    }
    return value
  } catch {
    return {}
  }
}

function currentUserConsoleAuth(event: H3Event) {
  const consoleAuth = event.context.consoleAuth as AltocConsoleAuth | undefined
  if (!consoleAuth?.authenticated || consoleAuth.subjectType === 'service') return null
  return consoleAuth
}

export function currentAltocDeptCodes(event: H3Event) {
  const consoleAuth = currentUserConsoleAuth(event)
  if (!consoleAuth) return []

  return uniqueStrings([
    ...splitCodes(consoleAuth.deptCodes),
    ...splitCodes(consoleAuth.deptCode),
    ...splitCodes(consoleAuth.claims?.dept_codes),
    ...splitCodes(consoleAuth.claims?.dept_code)
  ])
}

export async function resolveAltocDataAccessQuery(
  event: H3Event,
  uid: string,
  currentDeptCodes: string[],
  resource: string,
  action: PermissionAction
): Promise<RuntimeQuery> {
  const normalizedUid = stringValue(uid)
  if (!normalizedUid) {
    return resolveAltocDataAccessQueryFromScopedGrants({
      appCode,
      grants: [],
      currentDeptCodes: [],
      resource,
      action
    })
  }

  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, normalizedUid, appCode, {
    resourceCode: resource,
    action
  })
  const hasGlobalAdminRole = hasAltocGlobalAdminRole(scoped.roles)
  const departmentTreeCodesByRoot = !hasGlobalAdminRole && scopedGrantsNeedDepartmentTree(scoped.grants)
    ? await loadDepartmentTreeCodeIndex()
    : undefined

  const query = resolveAltocDataAccessQueryFromScopedGrants({
    appCode,
    grants: scoped.grants,
    currentDeptCodes,
    resource,
    action,
    actionPolicy: scoped.actionPolicy,
    hasGlobalAdminRole,
    departmentTreeCodesByRoot
  })

  const currentDeptCodeValues = uniqueStrings(currentDeptCodes)
  query.current_user = normalizedUid
  query.operator_uid = normalizedUid
  if (currentDeptCodeValues.length > 0) {
    query.current_user_dept_code = currentDeptCodeValues[0]
    query.current_user_dept_codes = currentDeptCodeValues.join(',')
  }
  return query
}

export async function resolveCurrentAltocDataAccessQuery(
  event: H3Event,
  resource: string,
  action: PermissionAction
): Promise<RuntimeQuery> {
  return resolveAltocDataAccessQuery(
    event,
    getRequestUid(event),
    currentAltocDeptCodes(event),
    resource,
    action
  )
}
