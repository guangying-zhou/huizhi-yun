import { createError, type H3Event } from 'h3'
import { getConsoleDirectoryUser, getConsoleDirectoryUserDepartments, getConsoleDirectoryDepartments } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { subjectDepartmentTreeIndex } from './subjectDepartmentTree'
import { loadConsoleRuntimeMode } from './platformRuntime'
import { evaluateWithFreshNotificationDetailPolicy } from './notificationDetailFreshPolicy'
import { loadPolicyScopedAuthorization } from './policyScopedAuthorization'
import type { resolveSubjectScopedAuthorizationRequest } from './subjectScopedAuthorizationContract'

type Request = ReturnType<typeof resolveSubjectScopedAuthorizationRequest>

// Called only after service identity and fixed purpose have been resolved.
export async function loadSubjectScopedAuthorization(event: H3Event, request: Request) {
  let status: string
  try {
    const envelope = await getConsoleDirectoryUser(event, request.subjectUid, true)
    const row = envelope.data as { status?: unknown, statusKey?: unknown } | null
    status = String(row?.statusKey || row?.status || '').trim()
  } catch (error) {
    if (Number((error as { statusCode?: number }).statusCode) === 404) {
      throw createError({ statusCode: 403, message: 'subject_scoped_subject_inactive' })
    }
    throw createError({ statusCode: 503, message: 'subject_scoped_directory_unavailable' })
  }
  if (!['active', '1'].includes(status)) throw createError({ statusCode: 403, message: 'subject_scoped_subject_inactive' })
  let departmentCodes: string[] = []
  let departmentTree: Record<string, string[]> = {}
  if (request.targetAppCode === 'assets') {
    try {
      const envelope = await getConsoleDirectoryUserDepartments(event, request.subjectUid)
      const data = envelope.data as { departments?: Array<{ deptCode?: unknown, orgType?: unknown, relationType?: unknown }> } | null
      if (!Array.isArray(data?.departments)) throw new Error('missing departments')
      departmentCodes = [...new Set(data.departments.filter(row => row.orgType === 'department' && row.relationType === 'member').map((row) => {
        if (typeof row.deptCode !== 'string' || !row.deptCode || row.deptCode !== row.deptCode.trim()) throw new Error('invalid department')
        return row.deptCode
      }))].sort()
      const treeEnvelope = await getConsoleDirectoryDepartments(event, { status: 'active' })
      departmentTree = subjectDepartmentTreeIndex((treeEnvelope.data as { flat?: unknown } | null)?.flat)
    } catch {
      throw createError({ statusCode: 503, message: 'subject_scoped_departments_unavailable' })
    }
  }
  if (loadConsoleRuntimeMode(event).devPolicyBypassEnabled) {
    throw createError({ statusCode: 503, message: 'subject_scoped_policy_unavailable' })
  }
  try {
    return await evaluateWithFreshNotificationDetailPolicy(event, request, async () => {
      const snapshot = await loadPolicyScopedAuthorization(request.subjectUid, request.targetAppCode, event, {
        resourceCode: request.resourceCode,
        action: request.action,
        authorizationMode: 'merged',
        allowRoleSimulation: false,
        allowUserSimulation: false,
        allowPrivileged: false,
        ignoreSimulationSession: true,
        bypassSnapshotCache: true
      })
      if (snapshot.uid !== request.subjectUid || snapshot.appCode !== request.targetAppCode || snapshot.authorizationMode !== 'merged') {
        throw new Error('subject_scoped_snapshot_mismatch')
      }
      return {
        uid: snapshot.uid, appCode: snapshot.appCode, purpose: request.purpose,
        resourceCode: request.resourceCode, action: request.action,
        authorizationMode: snapshot.authorizationMode,
        policyRevision: snapshot.policyRevision, bundleVersion: snapshot.bundleVersion,
        grants: snapshot.grants, actionPolicy: snapshot.actionPolicy, departmentCodes, departmentTree
      }
    })
  } catch {
    throw createError({ statusCode: 503, message: 'subject_scoped_policy_unavailable' })
  }
}
