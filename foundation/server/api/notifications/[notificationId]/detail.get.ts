import { getRouterParam } from 'h3'
import {
  fetchConsoleNotificationsForUser,
  requireConsoleNotificationsUserCredentials
} from '../../../utils/notifications'

export default defineEventHandler(async (event) => {
  requireConsoleNotificationsUserCredentials(event)
  const notificationId = String(getRouterParam(event, 'notificationId') || '').trim()
  const data = await fetchConsoleNotificationsForUser(event, `/api/v1/console/notifications/${encodeURIComponent(notificationId)}/detail`)
  return { code: 0, message: 'success', data }
})
