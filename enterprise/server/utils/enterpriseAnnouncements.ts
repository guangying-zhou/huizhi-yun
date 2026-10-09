import { createError, readBody, getRouterParam, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import type { AnnouncementOperation } from '@hzy/foundation/server/utils/announcementPermit'
import { executeAnnouncementRequest, deliverImmediateAnnouncement, type AnnouncementDelivery } from '../../../console/server/public/announcements'

export async function enterpriseAnnouncements(event: H3Event, op: AnnouncementOperation) {
  const invoke = (operationName: AnnouncementOperation, commandOverride?: Record<string, unknown>, keyOverride?: string) => {
    const operation = `console.announcements-${operationName}` as const
    return executeAnnouncementRequest(event, operationName, {
      commandOverride, keyOverride,
      identity: async () => {
        const user = await requireEnterpriseUser(event)
        await prepareEnterpriseRuntime(event, operation)
        return user
      },
      authorize: (uid, action) => loadScopedAuthorizationFromConsoleRuntime(event, uid, 'console', { resourceCode: 'announcements', action }),
      call: (body, idempotencyKey) => callEnterpriseRuntime(event, operation, body, { idempotencyKey })
    })
  }
  const result = await invoke(op)
  if (op !== 'save' && op !== 'deliver') return result
  const command = op === 'save' ? await readBody<Record<string, unknown>>(event) : { id: getRouterParam(event, 'id') }
  if (op === 'save' && !command.bell && !command.wecom) return result
  const id = String(command.id || '')
  const delivery = await deliverImmediateAnnouncement(event, id, {
    claim: async () => {
      const response = await invoke('delivery-claim', { id }, `announcement-claim:${id}`) as { code: number, data: AnnouncementDelivery | null }
      if (response.code !== 0 || !Object.hasOwn(response, 'data') || (response.data && (response.data.id !== id || !['in_app', 'wecom'].includes(response.data.channel)))) throw createError({ statusCode: 503, message: '公告投递响应无效' })
      return response.data
    },
    ack: (job, success) => invoke('delivery-ack', { id, delivery: job, success }, `announcement-ack:${job.lease}`)
  })
  const state = await invoke('deliver', { id }, `announcement-status:${id}`) as { data: { items: { id: string, delivery?: { pending: number } }[] } }
  const pending = state.data.items.find(item => item.id === id)?.delivery?.pending
  return { ...(result as Record<string, unknown>), notificationDelivery: { ...delivery, pending: pending ?? null } }
}
