import { notificationReadQuery } from '../../../shared/utils/notificationReadQuery'
import { createError, getQuery, setHeader } from 'h3'
import { fetchConsoleNotificationsForUser } from '../../utils/notifications'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const data = await fetchConsoleNotificationsForUser(event, '/api/v1/console/notifications', {
    query: validatedQuery(event)
  })
  return { code: 0, message: 'success', data }
})

function validatedQuery(event: import('h3').H3Event) {
  try { return notificationReadQuery(getQuery(event)) } catch { throw createError({ statusCode: 400, message: '通知分页参数无效' }) }
}
