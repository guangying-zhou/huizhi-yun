import { randomUUID } from 'node:crypto'
import { getHeader, readBody } from 'h3'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { applyDingTalkDepartmentMappings } from '~~/server/utils/dingTalkHRSource'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'

export default defineEventHandler(async (event) => {
  await assertPeoplePermission(event, 'hr_source_sync', 'admin')
  const actorUid = getRequestUid(event)
  if (!actorUid) throw createError({ statusCode: 401, message: 'People HR source migration requires login.' })
  const body = await readBody<{ mappings?: unknown[] }>(event)
  const mappings = Array.isArray(body.mappings) ? body.mappings : []
  const idempotencyKey = String(getHeader(event, 'idempotency-key') || `people-dingtalk-dept-migration-${randomUUID()}`).trim()
  return { code: 0, data: await applyDingTalkDepartmentMappings(event, actorUid, mappings, idempotencyKey) }
})
