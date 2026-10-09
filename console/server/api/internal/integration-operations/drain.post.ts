import { drainAnnouncements } from '../../../utils/announcementDelivery'
import { drainFeedbackForEvent, feedbackTask } from '~~/server/utils/feedbackDelivery'
import { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { drainPlatformLifecycleActionablesForEvent } from '~~/server/utils/platformLifecycleActionableDrain'
import { drainPlatformLifecycleOperationsForEvent } from '~~/server/utils/platformLifecycleOperation'

export default defineEventHandler(async (event) => {
  await requireTenantGatewaySchedulerRequest(event, 'console')
  const request = await readBody(event)
  if (request?.feedbackOnly === true) {
    if (Object.keys(request).some(key => !['feedbackOnly', 'phase'].includes(key)) || ![undefined, 'issue', 'notification'].includes(request.phase) || useRuntimeConfig(event).feedbackDeliveryEnabled !== true) throw createError({ statusCode: 403, message: 'feedback_lane_disabled' })
    return { code: 0, data: { feedback: request.phase === 'issue' ? { issue: await feedbackTask(event, 'drain') } : await drainFeedbackForEvent(event) } }
  }
  const result = await drainPlatformLifecycleOperationsForEvent(event, {
    maxClaims: 10,
    maxDurationMs: 25_000,
    claimReserveMs: 12_000
  })
  const actionables = result.claimed > 0
    ? { skipped: true, reason: 'operation_drain_precedes_actionables' }
    : await drainPlatformLifecycleActionablesForEvent(event, { limit: 1 })
  const announcements = result.claimed > 0 ? { skipped: true } : await drainAnnouncements(event)
  const feedback = useRuntimeConfig(event).feedbackDeliveryEnabled === true && result.claimed === 0
    ? await drainFeedbackForEvent(event)
    : { skipped: true }
  return { code: 0, data: { result, actionables, announcements, feedback } }
})
