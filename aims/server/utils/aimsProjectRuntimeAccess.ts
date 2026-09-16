import type { H3Event } from 'h3'
import {
  checkAimsScopedPermission,
  resolveAimsProjectAuthorizationObject,
  resolveAimsProjectListAdminScopeQuery
} from '~~/server/utils/aimsScopedAuthorization'
import { fetchUserDepartments } from '~~/server/utils/userDepartments'

interface DeptNode {
  deptCode?: string
  children?: DeptNode[]
}

interface ProjectRuntimeAccessQueryInput {
  projectId: string | number
  uid: string
  baseQuery?: Record<string, unknown>
}

interface ProjectListRuntimeAccessQueryInput {
  uid: string
  baseQuery?: Record<string, unknown>
}

export async function buildAimsProjectRuntimeAccessQuery(
  event: H3Event,
  input: ProjectRuntimeAccessQueryInput
): Promise<Record<string, unknown>> {
  const uid = String(input.uid || '').trim()
  const projectId = String(input.projectId || '').trim()
  const query: Record<string, unknown> = {
    ...(input.baseQuery || {}),
    current_user: uid
  }
  if (!uid || !projectId) return query

  const visibilityContext = await resolveProjectVisibilityContext(event, uid)
  applyProjectVisibilityQuery(query, visibilityContext)

  const object = await resolveAimsProjectAuthorizationObject(event, {
    projectId,
    uid,
    currentDeptCodes: visibilityContext.deptCodes,
    managementDeptCodes: visibilityContext.managementDeptCodes
  })
  query.current_user_is_project_admin = await checkAimsScopedPermission(event, {
    resourceCode: 'projects',
    action: 'admin',
    object
  })
    ? '1'
    : '0'

  return query
}

export async function buildAimsProjectListRuntimeAccessQuery(
  event: H3Event,
  input: ProjectListRuntimeAccessQueryInput
): Promise<Record<string, unknown>> {
  const uid = String(input.uid || '').trim()
  const query: Record<string, unknown> = {
    ...(input.baseQuery || {}),
    current_user: uid
  }
  if (!uid) return query

  const visibilityContext = await resolveProjectVisibilityContext(event, uid)
  applyProjectVisibilityQuery(query, visibilityContext)
  Object.assign(query, await resolveAimsProjectListAdminScopeQuery(event, uid, visibilityContext))
  return query
}

function applyProjectVisibilityQuery(
  query: Record<string, unknown>,
  visibilityContext: Awaited<ReturnType<typeof resolveProjectVisibilityContext>>
) {
  if (visibilityContext.deptCodes.length > 0) {
    query.current_user_dept_codes = visibilityContext.deptCodes.join(',')
  }
  if (visibilityContext.managementDeptCodes.length > 0) {
    query.current_user_management_dept_codes = visibilityContext.managementDeptCodes.join(',')
  }
}

async function resolveProjectVisibilityContext(event: H3Event, uid: string) {
  try {
    const result = await fetchUserDepartments(event, uid)
    const codes = new Set<string>()
    if (result.primaryDeptCode) codes.add(result.primaryDeptCode)
    for (const dept of result.departments) {
      collectDeptCodes(dept, codes)
    }
    return {
      deptCodes: [...codes],
      managementDeptCodes: result.managedDeptCodes || []
    }
  } catch (error) {
    console.warn('[AimsProjectRuntimeAccess] failed to resolve project visibility context:', error)
    return { deptCodes: [], managementDeptCodes: [] }
  }
}

function collectDeptCodes(dept: DeptNode, codes: Set<string>) {
  const deptCode = String(dept.deptCode || '').trim()
  if (deptCode) codes.add(deptCode)
  for (const child of dept.children || []) {
    collectDeptCodes(child, codes)
  }
}
