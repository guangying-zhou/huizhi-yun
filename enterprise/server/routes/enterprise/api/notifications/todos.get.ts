import { todoReadQuery } from '@hzy/foundation/shared/utils/todoReadQuery'
import { createError, defineEventHandler, getQuery, setHeader } from 'h3'
import {
  fetchConsoleNotificationsForUser,
  requireConsoleNotificationsUserCredentials
} from '@hzy/foundation/server/utils/notifications'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireConsoleNotificationsUserCredentials(event)
  let query: Record<string, unknown>
  try { query = todoReadQuery(getQuery(event), true) } catch { throw createError({ statusCode: 400, message: 'Invalid todo query' }) }
  const data = await fetchConsoleNotificationsForUser(event, '/api/v1/console/notifications/todos', {
    query
  })
  return { code: 0, message: 'success', data }
})
