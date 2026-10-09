import { createError, type H3Event } from 'h3'
import { aimsApprovalActionDefinitions } from '../../../aims/layer/server'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestWithServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'

const synced = new Map<string, Promise<void>>()
// Signed Host wake invokes this explicitly; no Aims startup plugin is imported.
export async function syncEnterpriseAimsApprovalActions(event: H3Event, binding: { tenant: string, deployment: string, schedulerGeneration: string }) {
  const key = `${binding.tenant}:${binding.deployment}:${binding.schedulerGeneration}`
  if (!synced.has(key)) {
    const promise = requestWithServiceAccessToken({ audience: 'workflow', scope: 'workflow:action_defs:sync', event, async request(token) {
      const base = resolveServiceAppBaseUrl(event, 'workflow')
      if (!base) throw createError({ statusCode: 503, statusMessage: 'aims_approval_actions_unavailable' })
      const result = await serviceAppFetch<{ code: number }>(event, 'workflow', `${base.replace(/\/$/, '')}/api/v1/action-defs/sync`, {
        method: 'POST', headers: { ...trustedServiceRequestHeaders(event, 'workflow'), authorization: `Bearer ${token}` },
        body: { appCode: 'aims', actions: aimsApprovalActionDefinitions }, timeout: 10_000
      })
      if (result.code !== 0) throw createError({ statusCode: 503, statusMessage: 'aims_approval_actions_unavailable' })
    } })
    synced.set(key, promise)
    promise.catch(() => synced.delete(key))
  }
  await synced.get(key)
}
