import type { H3Event } from 'h3'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import type {
  FoundationObjectContext,
  FoundationScopePredicate,
  FoundationScopedAuthorizationGrant
} from '@hzy/foundation/server/utils/scopeEvaluator'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'

type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'assign' | 'submit' | 'approve' | 'confirm' | 'close' | 'export' | 'admin'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface AimsScopedPermissionOptions {
  resourceCode: string
  action: PermissionAction
  object?: FoundationObjectContext
}

type RuntimeRecord = Record<string, unknown>

interface AimsProjectListScopeContext {
  deptCodes?: string[]
  managementDeptCodes?: string[]
}

const NON_MEMBER_SENTINEL = '__hzy_not_current_project_member__'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function numberValue(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function field(record: RuntimeRecord | null | undefined, ...keys: string[]) {
  if (!record) return undefined
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && stringValue(value) !== '') return value
  }
  return undefined
}

function unwrapRuntimeData<T>(value: RuntimeEnvelope<T> | T): T | null {
  const envelope = value && typeof value === 'object' && !Array.isArray(value)
    ? value as RuntimeEnvelope<T>
    : null
  if (envelope && envelope.code !== undefined) {
    return envelope.code === 0 ? envelope.data ?? null : null
  }
  return value as T
}

function runtimeItems(value: unknown): RuntimeRecord[] {
  if (Array.isArray(value)) {
    return value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as RuntimeRecord[]
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as RuntimeRecord
    return runtimeItems(record.items ?? record.data)
  }
  return []
}

export async function checkAimsScopedPermission(
  event: H3Event,
  options: AimsScopedPermissionOptions
) {
  const uid = getRequestUid(event)
  if (!uid) return false

  const object = options.object
    ? { ...options.object, actorUid: options.object.actorUid || uid }
    : { actorUid: uid }
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, uid, appCode, {
    resourceCode: options.resourceCode,
    action: options.action,
    object
  })
  return scoped.decision?.allowed === true
}

export async function resolveAimsProjectListAdminScopeQuery(
  event: H3Event,
  uid: string,
  context: AimsProjectListScopeContext = {}
) {
  const normalizedUid = stringValue(uid)
  if (!normalizedUid) return {}

  try {
    const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, normalizedUid, appCode, {
      resourceCode: 'projects',
      action: 'admin'
    })
    const deptCodes = new Set<string>()
    const projectCodes = new Set<string>()

    for (const grant of scoped.grants) {
      if (!grantHasProjectAdminPermission(grant)) continue

      const listScope = projectListScopeFromGrant(grant, context)
      if (listScope.global) {
        return { current_user_is_project_admin: '1' }
      }
      for (const deptCode of listScope.deptCodes) {
        deptCodes.add(deptCode)
      }
      for (const projectCode of listScope.projectCodes) {
        projectCodes.add(projectCode)
      }
    }

    const query: Record<string, string> = {}
    if (deptCodes.size > 0) {
      query.current_user_project_admin_dept_codes = [...deptCodes].join(',')
    }
    if (projectCodes.size > 0) {
      query.current_user_project_admin_project_codes = [...projectCodes].join(',')
    }
    return query
  } catch (error) {
    console.warn('[AimsScopedAuthorization] failed to resolve project list admin scopes:', error)
    throw error
  }
}

function grantHasProjectAdminPermission(grant: FoundationScopedAuthorizationGrant) {
  return grant.permissions.some(permission =>
    permission.appCode === appCode
    && permission.resourceCode === 'projects'
    && permission.action === 'admin'
  )
}

function projectListScopeFromGrant(
  grant: FoundationScopedAuthorizationGrant,
  context: AimsProjectListScopeContext
) {
  const scopeGroups = [
    grant.defaultScopes || [],
    grant.assignmentScopes || [],
    grant.scopes || []
  ]
    .map(scopes => scopes.filter(scope => !isTenantGlobalScope(scope)))
    .filter(scopes => scopes.length > 0)

  if (scopeGroups.length === 0) {
    return { global: true, deptCodes: [], projectCodes: [] }
  }

  let dimension = ''
  let allowedCodes: string[] | null = null
  for (const scopes of scopeGroups) {
    const dimensions = new Set(scopes.map(scope => stringValue(scope.dimension)).filter(Boolean))
    if (dimensions.size !== 1) {
      return { global: false, deptCodes: [], projectCodes: [] }
    }
    const groupDimension = [...dimensions][0] || ''
    if (!dimension) {
      dimension = groupDimension
    } else if (dimension !== groupDimension) {
      return { global: false, deptCodes: [], projectCodes: [] }
    }

    const groupCodes = groupDimension === 'department'
      ? departmentListScopeCodes(scopes, context)
      : groupDimension === 'project'
        ? projectListScopeCodes(scopes)
        : []
    if (!groupCodes.length) {
      return { global: false, deptCodes: [], projectCodes: [] }
    }
    allowedCodes = allowedCodes === null
      ? groupCodes
      : allowedCodes.filter(code => groupCodes.includes(code))
  }

  const codes = allowedCodes || []
  if (dimension === 'department') {
    return {
      global: false,
      deptCodes: codes,
      projectCodes: []
    }
  }
  if (dimension === 'project') {
    return {
      global: false,
      deptCodes: [],
      projectCodes: codes
    }
  }
  return { global: false, deptCodes: [], projectCodes: [] }
}

function isTenantGlobalScope(scope: FoundationScopePredicate) {
  return stringValue(scope.dimension) === 'tenant' && stringValue(scope.predicate) === 'global'
}

function departmentListScopeCodes(
  scopes: FoundationScopePredicate[],
  context: AimsProjectListScopeContext
) {
  const codes = new Set<string>()
  for (const scope of scopes) {
    const predicate = stringValue(scope.predicate)
    const value = stringValue(scope.value)
    if (predicate !== 'self' && predicate !== 'tree') continue
    if (value) {
      codes.add(value)
      continue
    }
    const fallbackCodes = predicate === 'tree'
      ? context.managementDeptCodes || []
      : context.deptCodes || []
    for (const code of fallbackCodes) {
      if (stringValue(code)) codes.add(stringValue(code))
    }
  }
  return [...codes]
}

function projectListScopeCodes(scopes: FoundationScopePredicate[]) {
  const codes = new Set<string>()
  for (const scope of scopes) {
    const predicate = stringValue(scope.predicate)
    const value = stringValue(scope.value)
    if ((predicate === 'member' || predicate === 'owner') && value) {
      codes.add(value)
    }
  }
  return [...codes]
}

async function loadRuntimeRecord(
  event: H3Event,
  path: string,
  query: Record<string, unknown>
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<RuntimeRecord>>(event, path, {
    appCode,
    scope: 'aims.read',
    method: 'GET',
    query
  })
  if (!runtime.handled) return null
  return unwrapRuntimeData(runtime.data)
}

async function loadProjectMembers(
  event: H3Event,
  projectId: string,
  query: Record<string, unknown>
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<unknown>>(event, `/v1/aims/projects/${encodeURIComponent(projectId)}/members`, {
    appCode,
    scope: 'aims.read',
    method: 'GET',
    query
  })
  if (!runtime.handled) return []
  const data = unwrapRuntimeData(runtime.data)
  return runtimeItems(data)
}

export async function resolveAimsProjectAuthorizationObject(
  event: H3Event,
  input: {
    projectId: string
    uid: string
    currentDeptCodes?: string[]
    managementDeptCodes?: string[]
  }
): Promise<FoundationObjectContext> {
  const query: Record<string, unknown> = {
    current_user: input.uid
  }
  if (input.currentDeptCodes?.length) {
    query.current_user_dept_codes = input.currentDeptCodes.join(',')
  }
  if (input.managementDeptCodes?.length) {
    query.current_user_management_dept_codes = input.managementDeptCodes.join(',')
  }

  const project = await loadRuntimeRecord(event, `/v1/aims/projects/${encodeURIComponent(input.projectId)}/authorization-object`, query)
    || await loadRuntimeRecord(event, `/v1/aims/projects/${encodeURIComponent(input.projectId)}`, query)
    || {}
  const embeddedMembers = (project as RuntimeRecord).members
    ?? (project as RuntimeRecord).projectMembers
    ?? (project as RuntimeRecord).project_members
  const members = Array.isArray(embeddedMembers)
    ? runtimeItems(embeddedMembers)
    : await loadProjectMembers(event, input.projectId, query)
  const projectMemberUids = members
    .filter(member => !stringValue(field(member, 'status')) || stringValue(field(member, 'status')) === 'active')
    .map(member => stringValue(field(member, 'uid', 'user_uid', 'userUid')))
    .filter(Boolean)

  const actorIsMember = projectMemberUids.includes(input.uid)
  const projectOwnerUid = stringValue(field(project, 'leader_uid', 'leaderUid', 'owner_uid', 'ownerUid'))
  const ownerUid = stringValue(field(project, 'created_by', 'createdBy')) || projectOwnerUid
  const matchedRelations = new Set<string>()
  if (actorIsMember) {
    matchedRelations.add('project:member')
    matchedRelations.add('relation:project_member')
  }
  if (projectOwnerUid && projectOwnerUid === input.uid) {
    matchedRelations.add('project:owner')
    matchedRelations.add('project:manager')
    matchedRelations.add('relation:project_owner')
    matchedRelations.add('relation:project_manager')
  }

  return {
    actorUid: input.uid,
    ownerUid,
    projectOwnerUid,
    projectCode: stringValue(field(project, 'project_code', 'projectCode')) || input.projectId,
    departmentCode: stringValue(field(project, 'dept_code', 'deptCode')) || null,
    projectMemberUids: projectMemberUids.length ? projectMemberUids : [NON_MEMBER_SENTINEL],
    matchedRelations: [...matchedRelations],
    projectId: numberValue(field(project, 'id')) || numberValue(input.projectId) || input.projectId
  }
}
