import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'
import { fetchPeopleRankSeriesSettings } from '~~/server/utils/consoleRankSettings'

export default defineEventHandler(async (event) => {
  await assertPeoplePermission(event, 'standard_costs', 'view')

  const settings = await fetchPeopleRankSeriesSettings(event)
  return {
    code: 0,
    message: 'ok',
    data: settings
  }
})
