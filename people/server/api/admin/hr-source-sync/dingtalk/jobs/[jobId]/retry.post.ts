import { getHeader, getRouterParam } from 'h3'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { mutateDingTalkPeopleSync } from '~~/server/utils/dingTalkHRSource'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'

export default defineEventHandler(async (event) => {
  await assertPeoplePermission(event, 'hr_source_sync', 'execute')
  const actorUid = getRequestUid(event)
  if (!actorUid) throw createError({ statusCode: 401, message: 'People HR source sync requires login.' })
  const jobId = String(getRouterParam(event, 'jobId') || '')
  const idempotencyKey = String(getHeader(event, 'idempotency-key') || `people-dingtalk-job-retry-${jobId}`).trim()
  return await mutateDingTalkPeopleSync(event, actorUid, jobId, 'retry', idempotencyKey)
})
