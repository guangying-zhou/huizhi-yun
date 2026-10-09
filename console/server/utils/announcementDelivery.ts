import { createError, type H3Event } from 'h3'
import { sendExternalNotificationOnly } from '@hzy/foundation/server/utils/notify'
import { publishNotification } from '@hzy/foundation/server/utils/notifications'
import { runAnnouncementDelivery, type AnnouncementDelivery } from './announcementDeliveryCore'

// Delivery runs only as part of the currently authorized Host admin operation.
export async function deliverImmediateAnnouncement(event: H3Event, id: string, deps: {
  claim: () => Promise<AnnouncementDelivery | null>
  ack: (job: AnnouncementDelivery, success: boolean) => Promise<unknown>
}) {
  const title = '系统公告提醒'
  const text = '有一条系统公告待查看，请登录汇智云查看当前可见内容。'
  const link = `/enterprise/announcements/${encodeURIComponent(id)}`
  return runAnnouncementDelivery({ ...deps,
    bell: async (job) => {
      const result = await publishNotification({ title, body: text, summary: text, severity: 'info', category: 'system', actionUrl: link, bizType: 'system_announcement', bizId: id, idempotencyKey: job.key, recipients: [job.uid], channels: ['in_app'], sourceAppCode: 'enterprise', event })
      if (!result.notificationId || !result.recipients.includes(job.uid)) throw createError({ statusCode: 503, message: 'Notification receipt unavailable' })
    },
    wecom: async (job) => {
      const result = await sendExternalNotificationOnly({ title, description: text, url: link, touser: job.uid, event, sourceAppCode: 'enterprise', idempotencyKey: job.key, channel: 'wecom' })
      if (!result || typeof result !== 'object' || (result as { code?: unknown }).code !== 0) throw createError({ statusCode: 503, message: 'External delivery receipt unavailable' })
    }
  })
}

// Legacy scheduler cannot deliver announcements in this rollout.
export async function drainAnnouncements(_event: H3Event) {
  return { enabled: false, delivered: 0 }
}
