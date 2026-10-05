import { createError, type H3Event } from 'h3'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import type { FoundationObjectContext } from '@hzy/foundation/server/utils/scopeEvaluator'
import { requireRequestUid } from './authIdentity'
import { fetchDirectoryProjectAccessByService } from './directoryService'

export const CODOCS_TRUSTED_ISSUE_PROJECT_QUERY_KEY = 'codocs_trusted_issue_project_code'

type IssueProjectAction = 'view' | 'edit'

function text(value: unknown) {
  return String(value || '').trim()
}

function unavailable(message: string) {
  return createError({
    statusCode: 503,
    statusMessage: 'ISSUE_PROJECT_SCOPE_UNAVAILABLE',
    message
  })
}

/**
 * Resolves a single Issue project into a request-target-bound runtime marker.
 * Directory and scoped-policy facts are deliberately fetched without a local
 * fallback: an incomplete project relation must never become a broad allow.
 */
export async function resolveIssueProjectAccess(
  event: H3Event,
  rawProjectCode: unknown,
  action: IssueProjectAction
) {
  const actorUid = requireRequestUid(event)
  const projectCode = text(rawProjectCode)
  if (!projectCode) {
    throw createError({ statusCode: 400, message: 'project_code 不能为空' })
  }

  let access
  try {
    access = (await fetchDirectoryProjectAccessByService(event, projectCode, actorUid)).data
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error) throw error
    throw unavailable('项目范围所需的目录事实不可用')
  }

  if (!access || text(access.projectCode) !== projectCode) {
    throw createError({ statusCode: 404, message: '项目不存在' })
  }

  const projectDeptCode = text(access.deptCode)
  const authorizationObject: FoundationObjectContext = {
    actorUid,
    projectCode,
    projectOwnerUid: text(access.leaderUid) || null,
    departmentCode: projectDeptCode || null,
    departmentTree: access.departmentTree || [],
    projectMemberUids: access.actorIsMember ? [actorUid] : []
  }

  try {
    const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, actorUid, 'codocs', {
      resourceCode: 'projects',
      action,
      object: authorizationObject
    })
    if (scoped.decision?.allowed !== true) {
      throw createError({ statusCode: 403, message: '缺少该项目的问题访问权限' })
    }
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error) throw error
    throw unavailable('项目范围授权不可用')
  }

  return {
    actorUid,
    projectCode,
    runtimeQuery: { [CODOCS_TRUSTED_ISSUE_PROJECT_QUERY_KEY]: projectCode }
  }
}

/** Removes every browser-controlled project/actor marker before the scoped BFF adds its own marker. */
export function issueRuntimeQuery(source: Record<string, unknown>, projectCode: string) {
  const query: Record<string, unknown> = { ...source }
  for (const key of [
    'project_code', 'projectCode',
    CODOCS_TRUSTED_ISSUE_PROJECT_QUERY_KEY,
    'current_user', 'currentUser', 'operator_uid', 'operatorUid', 'actor_uid', 'actorUid',
    'hzy_runtime_actor_delegated', 'hzyRuntimeActorDelegated',
    'hzy_runtime_actor_purpose', 'hzyRuntimeActorPurpose'
  ]) {
    Reflect.deleteProperty(query, key)
  }
  return { ...query, [CODOCS_TRUSTED_ISSUE_PROJECT_QUERY_KEY]: projectCode }
}

export function issueProjectCode(value: unknown) {
  return text(value)
}
