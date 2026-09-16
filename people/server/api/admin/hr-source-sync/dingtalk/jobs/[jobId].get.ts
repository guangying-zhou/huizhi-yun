import { getRouterParam } from 'h3'
import { getDingTalkPeopleSync } from '~~/server/utils/dingTalkHRSource'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'

export default defineEventHandler(async (event) => {
  await assertPeoplePermission(event, 'hr_source_sync', 'view')
  return await getDingTalkPeopleSync(event, String(getRouterParam(event, 'jobId') || ''))
})
