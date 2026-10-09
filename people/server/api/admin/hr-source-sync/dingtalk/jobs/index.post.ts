import { randomUUID } from 'node:crypto'
import { getHeader } from 'h3'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { assertDingTalkDepartmentMappingsReady, startDingTalkPeopleSync } from '~~/server/utils/dingTalkHRSource'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'

export default defineEventHandler(async (event) => {
  await assertPeoplePermission(event, 'hr_source_sync', 'execute')
  await assertDingTalkDepartmentMappingsReady(event)
  const actorUid = getRequestUid(event)
  if (!actorUid) throw createError({ statusCode: 401, message: 'People HR source sync requires login.' })
  const idempotencyKey = String(getHeader(event, 'idempotency-key') || `people-dingtalk-sync-${randomUUID()}`).trim()
  return await startDingTalkPeopleSync(event, actorUid, idempotencyKey)
})
