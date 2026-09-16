import { getDingTalkDepartmentChanges } from '~~/server/utils/dingTalkHRSource'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'

export default defineEventHandler(async (event) => {
  await assertPeoplePermission(event, 'hr_source_sync', 'view')
  return await getDingTalkDepartmentChanges(event)
})
