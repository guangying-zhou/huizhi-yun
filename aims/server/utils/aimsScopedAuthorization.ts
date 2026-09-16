import { createError, type H3Event } from 'h3'
import { requireAimsProjectAuthorizationRecord } from './aimsProjectAuthorizationRecord'
import { runtimeEnvelopeError } from './aimsRuntimeForward'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import type {
  FoundationObjectContext
} from '@hzy/foundation/server/utils/scopeEvaluator'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'
import {
  aimsProjectListAdminScopeQueryFromGrants,
  type AimsProjectListScopeContext
} from './aimsProjectListScopeCore'

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
    return aimsProjectListAdminScopeQueryFromGrants(scoped.grants, context)
  } catch (error) {
    console.warn('[AimsScopedAuthorization] failed to resolve project list admin scopes:', error)
    throw error
  }
}

async function loadRuntimeRecord(
  event: H3Event,
  path: string,
  query: Record<string, unknown>,
  strict = false
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<RuntimeRecord>>(event, path, {
    appCode,
    scope: 'aims.read',
    method: 'GET',
    query
  })
  if (!runtime.handled) {
    if (strict) throw createError({ statusCode: 503, message: '项目授权事实服务暂不可用' })
    return null
  }
  if (strict && runtime.data?.code !== 0) {
    if (runtime.data?.code !== undefined) throw runtimeEnvelopeError(runtime.data)
    throw createError({ statusCode: 503, message: '项目授权事实响应不完整' })
  }
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
    requireCompleteFacts?: boolean
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

  const authorizationRecord = await loadRuntimeRecord(event, `/v1/aims/projects/${encodeURIComponent(input.projectId)}/authorization-object`, query, input.requireCompleteFacts)
  const project = input.requireCompleteFacts
    ? requireAimsProjectAuthorizationRecord(authorizationRecord, input.projectId)
    : authorizationRecord || await loadRuntimeRecord(event, `/v1/aims/projects/${encodeURIComponent(input.projectId)}`, query) || {}
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
    projectMemberUids,
    matchedRelations: [...matchedRelations],
    projectId: numberValue(field(project, 'id')) || numberValue(input.projectId) || input.projectId
  }
}
