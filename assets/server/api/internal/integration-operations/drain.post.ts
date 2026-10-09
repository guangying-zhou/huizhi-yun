import { createError, defineEventHandler } from 'h3'
import { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { drainAssetsDueNotifications } from '~~/server/utils/dueNotificationDrain'
import { requireAssetsScheduledRuntimeBinding } from '~~/server/utils/scheduledRuntime'
import { callAssetsUnifiedDueNotification } from '~~/server/utils/unifiedSchedulerRuntime'

// Signed Tenant Gateway wake for the unified Assets scheduler. Assets has no
// legacy wake: without a registered unified/recovered selection this refuses,
// and the Gateway only wakes Assets when that selection is persisted.
export default defineEventHandler(async (event) => {
  const verified = await requireTenantGatewaySchedulerRequest(event, 'assets')
  if (!['unified', 'recovered'].includes(verified.schedulerStorage)) {
    throw createError({ statusCode: 503, message: 'Assets scheduled work requires a registered unified scheduler.' })
  }
  const binding = requireAssetsScheduledRuntimeBinding()
  if (binding.tenant !== verified.tenant || binding.deployment !== verified.deployment) {
    throw createError({ statusCode: 403, message: 'Scheduler binding does not match the signed wake.' })
  }
  try {
    const dueNotifications = await drainAssetsDueNotifications({
      event,
      pageSize: 50,
      maxPagesPerStream: 1,
      maxWallTimeMs: 10_000,
      runtime: (path, body) => callAssetsUnifiedDueNotification(event, path, body, verified.schedulerGeneration)
    })
    // No Assets outbox is drained here, so the wake never asks for continuation.
    return { code: 0, data: { result: { claimed: 0 }, dueNotifications } }
  } catch (error) {
    console.error('[assets] unified due notification wake failed', {
      tenant: verified.tenant,
      deployment: verified.deployment,
      requestId: verified.requestId,
      message: String((error as Error)?.message || error)
    })
    throw error
  }
})
