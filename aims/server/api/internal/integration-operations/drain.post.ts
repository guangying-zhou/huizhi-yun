import { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { drainIntegrationOperationsForEvent } from '~~/server/utils/integrationOperationDrain'

/**
 * 计划唤醒的 drain 失败时必须留下可诊断记录。
 *
 * 2026-08-23 的教训：该端点连续数周每 5 分钟 503，但因为链路上多处
 * `createError({ statusCode: 503 })` 都不打日志，Worker tail 里 `logs: []`、
 * `exceptions: []`，只能看到一个孤零零的 503，无从判断是 Console 授权、
 * runtime endpoint 还是 token 问题。定时任务静默失败是最难发现的故障类型。
 */
export default defineEventHandler(async (event) => {
  const binding = await requireTenantGatewaySchedulerRequest(event, 'aims')
  try {
    const result = await drainIntegrationOperationsForEvent(event, binding, {
      maxClaims: 10,
      maxWallTimeMs: 25_000,
      claimReserveMs: 12_000
    })
    return { code: 0, data: result }
  } catch (error) {
    const failure = error as {
      statusCode?: number
      statusMessage?: string
      message?: string
      data?: unknown
      cause?: unknown
    }
    console.error('[aims] integration operation drain failed', {
      tenant: binding.tenant,
      deployment: binding.deployment,
      requestId: binding.requestId,
      statusCode: failure.statusCode || 0,
      message: String(failure.message || failure.statusMessage || error),
      data: failure.data,
      cause: failure.cause ? String(failure.cause) : undefined
    })
    throw error
  }
})
