import { createError, type H3Event } from 'h3'
import { getConsoleDirectoryUser } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { loadConsoleRuntimeMode } from '~~/server/utils/platformRuntime'
import { evaluateWithRevisionCheckedConsoleServicePolicy } from '~~/server/utils/revisionCheckedServicePolicy'
import { loadPolicyAuthorizationSnapshot } from '~~/server/utils/policyAuthorization'
import { evaluateFlatSnapshotPermission } from '~~/server/utils/policyAuthorizationGrants'
import {
  decideSubjectEligibility,
  type SubjectEligibilityRequest
} from './subjectEligibilityContract'

export async function evaluateSubjectEligibility(
  event: H3Event,
  binding: { tenantId: string, deploymentId: string },
  request: SubjectEligibilityRequest
) {
  return await decideSubjectEligibility(request, {
    loadDirectoryStatus: async (uid) => {
      try {
        const envelope = await getConsoleDirectoryUser(event, uid, true)
        const row = envelope.data as { status?: unknown, statusKey?: unknown } | null
        const status = String(row?.statusKey || row?.status || '').trim()
        if (status === '1') return 'active'
        if (status === '0') return 'inactive'
        if (status === '-1') return 'deleted'
        return status || null
      } catch (error) {
        const statusCode = Number((error as { statusCode?: unknown })?.statusCode || 0)
        if (statusCode === 404) return null
        throw createError({ statusCode: 503, message: 'subject_eligibility_directory_unavailable' })
      }
    },
    evaluatePermission: async (input) => {
      const mode = loadConsoleRuntimeMode(event)
      if (mode.devPolicyBypassEnabled) {
        throw createError({ statusCode: 503, message: 'subject_eligibility_policy_unavailable' })
      }
      try {
        return await evaluateWithRevisionCheckedConsoleServicePolicy(event, binding.tenantId, async () => {
          const snapshot = await loadPolicyAuthorizationSnapshot(input.subjectUid, input.targetAppCode, event, {
            authorizationMode: 'merged',
            allowRoleSimulation: false,
            allowUserSimulation: false,
            allowPrivileged: false,
            ignoreSimulationSession: true,
            bypassSnapshotCache: true
          })
          const decision = evaluateFlatSnapshotPermission(snapshot.grants, {
            appCode: input.targetAppCode,
            resourceCode: input.resourceCode,
            action: input.action
          }, snapshot.actionPolicies[input.resourceCode])
          return { allowed: decision.allowed, policyRevision: snapshot.policyRevision }
        })
      } catch {
        throw createError({ statusCode: 503, message: 'subject_eligibility_policy_unavailable' })
      }
    }
  })
}
