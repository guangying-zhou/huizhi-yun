import { createError, getQuery, setHeader } from 'h3'
import { todoReadQuery } from '@hzy/foundation/shared/utils/todoReadQuery'
import { listUserPendingActionables, requireNotificationUserUid } from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  await requireNotificationUserUid(event)
  let query: Record<string, unknown>
  try {
    query = todoReadQuery(getQuery(event))
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid todo query' })
  }
  return { code: 0, message: 'success', data: await listUserPendingActionables(event, query) }
})
