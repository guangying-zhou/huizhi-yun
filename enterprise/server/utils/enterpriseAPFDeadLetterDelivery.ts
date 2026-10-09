import { createError, type H3Event } from 'h3'
import { callEnterpriseAPFDeadLetterWorker } from '@hzy/foundation/server/utils/enterpriseRuntimeChannels'
import { publishIntegrationOperationDeadLetter, advanceNotificationActionableLifecycle } from '@hzy/foundation/server/utils/notifications'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'

type Domain = 'altoc' | 'finance' | 'people'
export type DeadCandidate = { OperationID: string, TargetApp: string, OperationCode: string, SourceBizType: string, SourceBizCode: string, LastErrorCode: string, LastErrorClass: string, OriginalActorUID: string, ActionableKey: string, ObjectVersion: string, Generation: number, OperationVersion: number, AttemptCount: number, MaxAttempts: number, DeadLetteredAt: string }
export type DeadClosure = { OperationID: string, ActionableKey: string, ExpectedVersion: string, NextVersion: string, State: 'resolved' | 'cancelled', Generation: number, RecipientUIDs: string[] }
export type DeadDependencies = { env: Record<string, unknown>, runtime: typeof callEnterpriseAPFDeadLetterWorker, publish: typeof publishIntegrationOperationDeadLetter, close: typeof advanceNotificationActionableLifecycle, binding: (event: H3Event) => { tenant: string, deployment: string }, now: () => number }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function identity(c: DeadCandidate | DeadClosure, domain: Domain) {
  const source = domain === 'people' ? 'enterprise' : domain
  if (!uuid.test(c.OperationID) || !Number.isSafeInteger(c.Generation) || c.Generation < 1 || c.ActionableKey !== `integration-operation:${source}:${c.OperationID}:dead-letter:g${c.Generation}`) throw createError({ statusCode: 503 })
}
function recipients(uids: string[]) {
  if (!Array.isArray(uids) || !uids.length || uids.length > 100 || new Set(uids).size !== uids.length || uids.some(uid => !uid || uid.length > 191 || uid.toLowerCase() === '@all' || [...uid].some(ch => ch.charCodeAt(0) < 32))) throw createError({ statusCode: 503 })
  return uids
}
/** One bounded pass on the existing signed wake. No timer, user impersonation or business mutation. */
export async function drainEnterpriseAPFDeadLetter(event: H3Event, domain: Domain, overrides: Partial<DeadDependencies> = {}) {
  const dep: DeadDependencies = { env: event.context.cloudflare?.env || event.context._platform?.cloudflare?.env || process.env, runtime: callEnterpriseAPFDeadLetterWorker, publish: publishIntegrationOperationDeadLetter, close: advanceNotificationActionableLifecycle, binding: (e) => {
    const b = resolveTrustedTenantGatewayContext(e)
    if (!b || b.appCode !== 'enterprise' || !b.tenant || !b.deployment) throw createError({ statusCode: 403 })
    return { tenant: b.tenant, deployment: b.deployment }
  }, now: Date.now, ...overrides }
  const counts = { published: 0, closed: 0, failed: 0, disabled: dep.env[`HZY_ENTERPRISE_${domain.toUpperCase()}_DEAD_LETTER_NOTIFICATIONS_ENABLED`] !== 'true' }
  if (counts.disabled) return counts
  if (dep.env[`HZY_${domain.toUpperCase()}_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED`] !== 'false') {
    counts.failed++
    return counts
  }
  const deadline = dep.now() + 20000
  try {
    const binding = dep.binding(event)
    const pending = await dep.runtime<{ code: number, data: DeadCandidate[] }>(event, domain, 'pending-dead-letter-actionables', {})
    if (pending.code !== 0 || !Array.isArray(pending.data) || pending.data.length > 3) throw createError({ statusCode: 503 })
    for (const c of pending.data) {
      if (dep.now() >= deadline) break
      try {
        identity(c, domain)
        if (!Number.isSafeInteger(c.OperationVersion) || c.OperationVersion !== c.Generation || c.ObjectVersion !== `dead-letter:g${c.Generation}:operation-v${c.OperationVersion}`) throw createError({ statusCode: 503 })
        const receipt = await dep.publish({ tenantCode: binding.tenant, deploymentCode: binding.deployment, sourceApp: 'enterprise', moduleAppCode: domain, targetApp: c.TargetApp, operationId: c.OperationID, operationCode: c.OperationCode, sourceBizType: c.SourceBizType, sourceBizCode: c.SourceBizCode, attemptCount: c.AttemptCount, maxAttempts: c.MaxAttempts, lastErrorCode: c.LastErrorCode || null, lastErrorClass: c.LastErrorClass || null, deadLetteredAt: c.DeadLetteredAt, originalActorUid: c.OriginalActorUID || null, generation: c.Generation, operationVersion: c.OperationVersion, actionableKey: c.ActionableKey, objectVersion: c.ObjectVersion }, event)
        if (!receipt.notificationId) throw createError({ statusCode: 503 })
        const ack = await dep.runtime<{ code: number, data: boolean }>(event, domain, 'dead-letter-actionable-published', { operationId: c.OperationID, generation: c.Generation, operationVersion: c.OperationVersion, actionableKey: c.ActionableKey, objectVersion: c.ObjectVersion, notificationId: receipt.notificationId, recipientUids: recipients(receipt.recipients!) })
        if (ack.code !== 0 || ack.data !== true) throw createError({ statusCode: 503 })
        counts.published++
      } catch { counts.failed++ }
    }
    if (dep.now() >= deadline) return counts
    const pendingClose = await dep.runtime<{ code: number, data: DeadClosure[] }>(event, domain, 'pending-dead-letter-closures', {})
    if (pendingClose.code !== 0 || !Array.isArray(pendingClose.data) || pendingClose.data.length > 3) throw createError({ statusCode: 503 })
    for (const c of pendingClose.data) {
      if (dep.now() >= deadline) break
      try {
        identity(c, domain)
        if (!['resolved', 'cancelled'].includes(c.State) || !c.ExpectedVersion || !c.NextVersion) throw createError({ statusCode: 503 })
        await dep.close({ sourceAppCode: 'enterprise', actionableKey: c.ActionableKey, expectedVersion: c.ExpectedVersion, nextVersion: c.NextVersion, state: c.State, recipients: recipients(c.RecipientUIDs) }, event)
        const ack = await dep.runtime<{ code: number, data: boolean }>(event, domain, 'dead-letter-closure-acknowledged', { operationId: c.OperationID, generation: c.Generation, actionableKey: c.ActionableKey, expectedVersion: c.ExpectedVersion, nextVersion: c.NextVersion, state: c.State })
        if (ack.code !== 0 || ack.data !== true) throw createError({ statusCode: 503 })
        counts.closed++
      } catch { counts.failed++ }
    }
  } catch { counts.failed++ }
  return counts
}
