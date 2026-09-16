import { getQuery } from 'h3'
import { listUserPendingActionables, requireNotificationUserUid } from '~~/server/utils/notifications'

function value(input: unknown) {
  return String(Array.isArray(input) ? input[0] || '' : input || '').trim()
}

export default defineEventHandler(async (event) => {
  await requireNotificationUserUid(event)
  const query = getQuery(event)
  return {
    code: 0,
    message: 'success',
    data: await listUserPendingActionables(event, {
      todoKind: value(query.todoKind || query.todo_kind),
      category: value(query.category),
      sourceAppCode: value(query.sourceAppCode || query.source_app_code),
      limit: query.limit,
      cursor: value(query.cursor)
    })
  }
})
