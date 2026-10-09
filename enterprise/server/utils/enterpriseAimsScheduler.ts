import { syncEnterpriseAimsApprovalActions } from './enterpriseAimsApprovalActions'
import { createError, type H3Event } from 'h3'
import { requireTenantGatewaySchedulerRequest } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { drainHostAimsScheduler, createHostAimsSchedulerIO } from '../../../aims/layer/server'

export const aimsHostWakePath = '/enterprise/api/internal/aims/drain'
export async function drainEnterpriseAims(event: H3Event) {
  const binding = await requireTenantGatewaySchedulerRequest(event, 'enterprise', aimsHostWakePath)
  if (!['unified', 'recovered'].includes(binding.schedulerStorage)) throw createError({ statusCode: 503, statusMessage: 'aims_scheduler_storage_unavailable' })
  await syncEnterpriseAimsApprovalActions(event, binding)
  const call = async <T>(path: string, scope: string, body: Record<string, unknown>): Promise<T> => {
    const response = await maybeCallTenantRuntime<{ code: number | string, data: T }>(event, path, {
      appCode: 'enterprise', scope, capabilityFormat: 'business', serviceTokenSourceBinding: 'service-client-policy',
      enterpriseScheduler: { generation: binding.schedulerGeneration }, method: 'POST', query: {}, body
    })
    if (!response.handled || String(response.data.code) !== '0') throw createError({ statusCode: 503, statusMessage: 'aims_scheduler_runtime_unavailable' })
    return response.data.data
  }
  const io = createHostAimsSchedulerIO(event, async <T>(path: string, body: Record<string, unknown>) => await call<T>(path, 'aims:integration_operation:execute', body))
  return await drainHostAimsScheduler({
    event, tenant: binding.tenant, deployment: binding.deployment, io,
    options: { maxClaims: 10, maxWallTimeMs: 25_000, claimReserveMs: 12_000 },
    rollover: () => call('/v1/enterprise/aims/milestones:rollover-due', 'aims:milestone-rollover:execute', {}),
    due: { event, pageSize: 50, maxPagesPerStream: 2, maxWallTimeMs: 10_000, runtime: async <T>(path: string, body: Record<string, unknown>) => {
      const action = /^\/v1\/aims\/service\/notifications:(scan-due|acknowledge|acknowledge-closure)$/.exec(path)?.[1]
      if (!action) throw createError({ statusCode: 400 })
      return await call<T>(`/v1/enterprise/aims/notifications:${action}`, 'aims:notifications-due:execute', body)
    } }
  })
}
