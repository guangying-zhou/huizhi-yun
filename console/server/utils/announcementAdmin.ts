import { createError, type H3Event } from 'h3'
import type { AnnouncementOperation } from '@hzy/foundation/server/utils/announcementPermit'

// Independent Console is a link-only entry. No new service grants are required.
export async function consoleAnnouncements(_event: H3Event, _op: AnnouncementOperation) {
  throw createError({ statusCode: 410, message: '请到企业工作台的系统公告页面办理。' })
}
