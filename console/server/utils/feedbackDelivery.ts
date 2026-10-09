import { redactFeedbackDiagnostic } from '@hzy/foundation/shared/utils/feedbackPrivacy'
import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { getConsoleDirectoryUser } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { evaluateFoundationScopedAuthorization } from '@hzy/foundation/server/utils/scopeEvaluator'
import { sendNotification, NotificationDeliveryError } from '@hzy/foundation/server/utils/notify'
import { getCachedBundleInvalidReason, readActivationStatus, readCachedBundle } from './bundleCache'
import { loadPlatformRuntimeConfig, resolvePlatformRuntimeCacheScope } from './platformRuntime'
import { resolveConsoleRuntimeBinding } from './consoleRuntimeBinding'
import { evaluateWithRevisionCheckedConsoleServicePolicy } from './revisionCheckedServicePolicy'
import { loadPolicyScopedAuthorization } from './policyScopedAuthorization'
import { buildRoleHolderProjection } from './roleHolders'
import { publishPortalNotification } from './notifications'

interface FeedbackEvent {
  eventId: string
  recipientUids: string[]
  recipientRoleCodes: string[]
}
interface Delivery {
  eventId: string
  uid: string
  attempt: number
  feedbackId: string
  eventType: 'submitted' | 'failed' | 'unknown'
  kind: string
  title: string
  reporterName: string
  pageUrl: string
  issueUrl: string
  integrationCode: string
  publicUrl: string
}
export async function feedbackTask<T>(event: H3Event, op: string, body: Record<string, unknown> = {}) {
  const path = op === 'drain' ? '/v1/console/feedback:drain' : `/v1/console/feedback-notifications:${op}`
  if (!['drain', 'events', 'freeze', 'claim', 'ack'].includes(op))
    throw createError({ statusCode: 400 })
  const result = await maybeCallTenantRuntime<{
    data: T
  }>(event, path, {
    appCode: 'console', scope: 'console:feedback-delivery:execute', channel: 'system', method: 'POST', body
  })
  if (!result.handled)
    throw createError({ statusCode: 503, message: '反馈投递暂不可用' })
  return result.data.data
}
export async function feedbackRecipientEligible(event: H3Event, uid: string, roles?: string[]) {
  let directory
  try {
    directory = await getConsoleDirectoryUser(event, uid, true)
  } catch (error) {
    if (Number((error as {
      statusCode?: number
    }).statusCode) === 404)
      return false
    throw error
  }
  const row = directory.data as {
    status?: unknown
    statusKey?: unknown
  }
  if (!['active', '1'].includes(String(row.statusKey || row.status)))
    return false
  const snapshot = await loadPolicyScopedAuthorization(uid, 'console', event, {
    resourceCode: 'feedback', action: 'view', authorizationMode: 'merged', allowRoleSimulation: false,
    allowUserSimulation: false, allowPrivileged: false, ignoreSimulationSession: true, bypassSnapshotCache: true
  })
  if (snapshot.authorizationMode !== 'merged' || !snapshot.authorizationExpiresAt || snapshot.authorizationExpiresAt <= Date.now())
    throw createError({ statusCode: 503, message: '反馈通知权限暂不可用' })
  if (roles && !roles.some(r => snapshot.roles.includes(r)))
    return false
  return evaluateFoundationScopedAuthorization({ grants: snapshot.grants, required: { appCode: 'console', resourceCode: 'feedback', action: 'view' }, policyOf: () => snapshot.actionPolicy }).allowed
}
async function recipients(event: H3Event, intent: FeedbackEvent, deadline: number) {
  const binding = resolveConsoleRuntimeBinding(event)
  return evaluateWithRevisionCheckedConsoleServicePolicy(event, binding.tenantId, async () => {
    const config = loadPlatformRuntimeConfig(event)
    const cacheScope = resolvePlatformRuntimeCacheScope(config, event)
    const [activation, bundle] = await Promise.all([readActivationStatus(config.bundleCacheDir, cacheScope, event), readCachedBundle(config.bundleCacheDir, cacheScope, event)])
    if (!bundle || getCachedBundleInvalidReason(bundle) || !activation.activated || !activation.bundleReady || bundle.tenantCode !== binding.tenantId || (config.activationMode !== 'managed-cloud-multitenant' && bundle.deploymentCode !== binding.deploymentId))
      throw createError({ statusCode: 503, message: '反馈通知策略暂不可用' })
    const direct = new Set(intent.recipientUids)
    const candidates = new Set([...direct, ...buildRoleHolderProjection(bundle.payload, intent.recipientRoleCodes).flatMap(r => r.holders.map(h => h.uid))])
    if (candidates.size > 100)
      throw createError({ statusCode: 503, message: '反馈接收人超过上限，请调整配置' })
    const resolved: string[] = []
    for (const uid of candidates) {
      if (Date.now() >= deadline) throw createError({ statusCode: 503, message: '反馈接收人核验等待下一批' })
      if (await feedbackRecipientEligible(event, uid, direct.has(uid) ? undefined : intent.recipientRoleCodes)) resolved.push(uid)
    }
    return resolved.sort()
  })
}
// Bounded trusted-scheduler entry, independent of the employee's request.
export async function drainFeedbackForEvent(event: H3Event) {
  const started = Date.now()
  const issue = { skipped: true }
  const intents = await feedbackTask<FeedbackEvent[]>(event, 'events')
  for (const intent of intents.slice(0, 3)) {
    const uids = await recipients(event, intent, started + 8000)
    if (uids.length)
      await feedbackTask(event, 'freeze', { eventId: intent.eventId, recipients: uids })
  }
  if (Date.now() - started > 10_000) return { issue, notified: false }
  const delivery = await feedbackTask<Delivery | null>(event, 'claim')
  if (!delivery)
    return { issue: await feedbackTask(event, 'drain'), notified: false }
  const ack = { eventId: delivery.eventId, uid: delivery.uid, attempt: delivery.attempt, inApp: false, wecom: false, skip: false }
  const binding = resolveConsoleRuntimeBinding(event)
  const allowed = await evaluateWithRevisionCheckedConsoleServicePolicy(event, binding.tenantId, () => feedbackRecipientEligible(event, delivery.uid))
  if (!allowed) {
    await feedbackTask(event, 'ack', { ...ack, skip: true })
    return { issue, skipped: true }
  }
  // Absolute external link only from trusted deployment configuration.
  // Frozen at submission from settings validated against deployment public URL.
  const origin = delivery.publicUrl.replace(/\/$/, '')
  let base: URL
  try {
    base = new URL(origin)
  } catch {
    throw createError({ statusCode: 503, message: '反馈通知公共入口未配置' })
  }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/')
    throw createError({ statusCode: 503, message: '反馈通知公共入口无效' })
  const state = delivery.eventType === 'submitted' ? '已创建' : delivery.eventType === 'unknown' ? '待核对' : '创建失败'
  const kind = ({ bug: '问题', feature: '需求', suggestion: '建议' } as Record<string, string>)[delivery.kind] || '反馈'
  const safe = (value: string) => redactFeedbackDiagnostic(value).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || '')).replace(/[\r\n]/g, ' ')
  const description = `类型：${kind}\n标题：${safe(delivery.title)}\n提交人：${safe(delivery.reporterName)}\n页面：${safe(delivery.pageUrl) || '未提供'}\nGitLab：${delivery.issueUrl || '尚未创建'}`
  try {
    const result = await sendNotification({
      event, touser: [delivery.uid], sourceAppCode: 'console', eventType: `console.feedback.${delivery.eventType}`,
      category: 'feedback', severity: delivery.eventType === 'submitted' ? 'info' : 'warning',
      title: `反馈${state}：${safe(delivery.title)}`, description,
      url: `${origin}/enterprise/feedback/${encodeURIComponent(delivery.feedbackId)}`,
      integrationCode: delivery.integrationCode, idempotencyKey: `feedback:${delivery.eventId}:${delivery.uid}`,
      bizType: 'feedback', bizId: delivery.feedbackId, metadata: { authorizationDescriptor: { resource: 'feedback', id: delivery.feedbackId } }
    }, { publishInApp: input => publishPortalNotification(input, { actorId: 'console.feedback-worker', appCode: 'console' }, event) })
    ack.inApp = result.inApp.status === 'fulfilled'
    ack.wecom = result.external.status === 'fulfilled'
    // A local in-app-only run is not evidence of external delivery.
  } catch (error) {
    if (!(error instanceof NotificationDeliveryError))
      throw error
    ack.inApp = error.result.inApp.status === 'fulfilled'
    ack.wecom = error.result.external.status === 'fulfilled'
  }
  await feedbackTask(event, 'ack', ack)
  return { issue, notified: ack.inApp && ack.wecom }
}
