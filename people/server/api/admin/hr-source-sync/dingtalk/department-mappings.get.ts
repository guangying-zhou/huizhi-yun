import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'
import { previewDingTalkDepartmentMappings } from '~~/server/utils/dingTalkHRSource'

export default defineEventHandler(async (event) => {
  await assertPeoplePermission(event, 'hr_source_sync', 'view')
  return await previewDingTalkDepartmentMappings(event)
})
