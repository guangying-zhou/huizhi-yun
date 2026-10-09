import { createError, type H3Event } from 'h3'
import { callEnterpriseAPFDueWorker, type APFDueFamily } from '@hzy/foundation/server/utils/enterpriseRuntimeChannels'
import { publishNotification, advanceNotificationActionableLifecycle, type PublishNotificationInput } from '@hzy/foundation/server/utils/notifications'
import { checkSubjectEligibility } from '@hzy/foundation/server/utils/subjectEligibility'

export type DueCandidate = { id: number, family: APFDueFamily, sourceKind: string, sourceId: number, sourceCode: string, recipientUid: string, dueAt: string, eventKey: string, objectVersion: string, notificationId: string, closureState: 'resolved' | 'cancelled' | '', recoveryOnly: boolean }
const families = {
  'sales-due': { domain: 'altoc', enable: 'HZY_ENTERPRISE_ALTOC_SALES_DUE_ENABLED', legacy: 'HZY_ALTOC_SALES_DUE_NOTIFICATIONS_ENABLED', title: '销售下一步已到期' },
  'billing-due': { domain: 'altoc', enable: 'HZY_ENTERPRISE_ALTOC_BILLING_DUE_ENABLED', legacy: 'HZY_ALTOC_RECEIVABLE_DUE_NOTIFICATIONS_ENABLED', title: '应收催收已到期' },
  'issuance-due': { domain: 'finance', enable: 'HZY_ENTERPRISE_FINANCE_ISSUANCE_DUE_ENABLED', legacy: 'HZY_FINANCE_DUE_NOTIFICATIONS_ENABLED', title: '开票办理已到期' },
  'reconciliation-due': { domain: 'finance', enable: 'HZY_ENTERPRISE_FINANCE_RECONCILIATION_DUE_ENABLED', legacy: 'HZY_FINANCE_DUE_NOTIFICATIONS_ENABLED', title: '到账核销已到期' },
  'handover-due': { domain: 'people', enable: 'HZY_ENTERPRISE_PEOPLE_HANDOVER_DUE_ENABLED', legacy: 'HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED', title: '离职交接已到期' },
  'asset-recovery-due': { domain: 'people', enable: 'HZY_ENTERPRISE_PEOPLE_ASSET_RECOVERY_DUE_ENABLED', legacy: 'HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED', title: '资产回收协调已到期' }
} as const
function duePurpose(c: DueCandidate) {
  return c.family === 'sales-due' && c.sourceKind === 'lead' ? 'apf_sales_lead_due' : `apf_${c.family.replaceAll('-', '_')}`
}
function input(event: H3Event, c: DueCandidate): PublishNotificationInput {
  return { event, sourceAppCode: 'enterprise', eventType: `enterprise.apf.${c.family}`, category: 'reminder', severity: 'warning',
    title: families[c.family].title, summary: '请核对当前负责的事项。', body: '此提醒不代表审批、开票、核销或归还已完成。',
    actionUrl: '/enterprise/notifications', bizType: 'apf_due_checkpoint', bizId: c.eventKey, idempotencyKey: c.eventKey, recipients: [c.recipientUid], channels: ['in_app'],
    metadata: { notificationKind: 'apf_due', moduleAppCode: families[c.family].domain, authorizationDescriptor: { resource: duePurpose(c), id: c.eventKey },
      actionableState: 'pending', actionableKey: c.eventKey, objectVersion: c.objectVersion, targetAppCode: 'enterprise', bizKey: c.eventKey }
  }
}
function candidate(raw: DueCandidate, family: APFDueFamily): DueCandidate {
  const parts = raw.eventKey?.split(':') || []
  const kinds = family === 'sales-due' ? ['lead', 'opportunity', 'sales_task'] : family === 'billing-due' ? ['billing_schedule'] : family === 'issuance-due' ? ['invoice_request'] : family === 'reconciliation-due' ? ['finance_receipt'] : ['offboarding_task']
  if (!kinds.includes(raw.sourceKind) || parts[2] !== raw.sourceKind || parts[3] !== String(raw.sourceId) || raw.family !== family || !Number.isSafeInteger(raw.id) || raw.id < 1 || !Number.isSafeInteger(raw.sourceId) || raw.sourceId < 1
    || !/^apf-due:[a-z-]+:[a-z_]+:[1-9][0-9]*:[1-9][0-9]*$/.test(raw.eventKey) || !raw.eventKey.startsWith(`apf-due:${family}:`) || raw.objectVersion !== raw.eventKey
    || !raw.recipientUid || raw.recipientUid.toLowerCase() === '@all' || raw.recipientUid.length > 64 || [...raw.recipientUid].some(character => character.charCodeAt(0) < 32)) throw createError({ statusCode: 503, message: 'apf_due_candidate_invalid' })
  return raw
}
export type DueDependencies = {
  env: Record<string, unknown>
  runtime: typeof callEnterpriseAPFDueWorker
  publish: typeof publishNotification
  close: typeof advanceNotificationActionableLifecycle
  eligibility: typeof checkSubjectEligibility
  now: () => number
}
/** Runs one bounded pass per independent family. No external notification channels. */
export async function drainEnterpriseAPFDue(event: H3Event, domain: 'altoc' | 'finance' | 'people', overrides: Partial<DueDependencies> = {}) {
  const env = event.context.cloudflare?.env || event.context._platform?.cloudflare?.env || process.env
  const dep: DueDependencies = { env, runtime: callEnterpriseAPFDueWorker, publish: publishNotification, close: advanceNotificationActionableLifecycle, eligibility: checkSubjectEligibility, now: Date.now, ...overrides }
  const result: Record<string, { published: number, closed: number, failed: number, disabled: boolean }> = {}
  const deadline = dep.now() + 20000
  await Promise.all(Object.entries(families).map(async ([name, config]) => {
    if (config.domain !== domain) return
    const family = name as APFDueFamily
    const counts = { published: 0, closed: 0, failed: 0, disabled: dep.env[config.enable] !== 'true' }
    result[family] = counts
    // Absent is not proof of old-owner retirement. Never request a token while disabled.
    if (counts.disabled) return
    if (dep.env[config.legacy] !== 'false') {
      counts.failed++
      return
    }
    if (dep.now() >= deadline) return
    try {
      const response = await dep.runtime<{ code: number, data: { items: DueCandidate[], closures: DueCandidate[] } }>(event, family, 'scan-due', {})
      if (response.code !== 0 || !Array.isArray(response.data?.items) || !Array.isArray(response.data?.closures) || response.data.items.length > 40 || response.data.closures.length > 20) throw createError({ statusCode: 503 })
      for (const raw of response.data.items) {
        if (dep.now() >= deadline) break
        try {
          const c = candidate(raw, family)
          let receipt: { notificationId?: string, found?: boolean, recipients?: string[] }
          if (c.recoveryOnly) {
            receipt = await dep.publish({ ...input(event, c), probeOnly: true })
            if (receipt.found === false) {
              // Absence cannot rule out a still in-flight original request. Preserve the pending intent; never force success.
              counts.failed++
              continue
            }
          } else {
            const eligible = await dep.eligibility({ event, subjectUid: c.recipientUid, purpose: duePurpose(c) })
            if (!eligible.active || !eligible.allowed) continue
            receipt = await dep.publish(input(event, c))
          }
          if (!receipt.notificationId || receipt.recipients?.length !== 1 || receipt.recipients[0] !== c.recipientUid) throw createError({ statusCode: 503 })
          await dep.runtime(event, family, 'published', { eventKey: c.eventKey, notificationId: receipt.notificationId, recipientUid: c.recipientUid })
          counts.published++
        } catch { counts.failed++ }
      }
      for (const raw of response.data.closures) {
        if (dep.now() >= deadline) break
        try {
          const c = candidate(raw, family)
          if (!c.notificationId || !['resolved', 'cancelled'].includes(c.closureState)) throw createError({ statusCode: 503 })
          await dep.close({ sourceAppCode: 'enterprise', actionableKey: c.eventKey, expectedVersion: c.objectVersion, nextVersion: `${c.objectVersion}:${c.closureState}`, state: c.closureState as 'resolved' | 'cancelled', recipients: [c.recipientUid] }, event)
          await dep.runtime(event, family, 'closure-ack', { eventKey: c.eventKey, state: c.closureState })
          counts.closed++
        } catch { counts.failed++ }
      }
    } catch { counts.failed++ }
  }))
  return result
}
