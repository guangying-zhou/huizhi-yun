import { getQuery } from 'h3'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'
import { fetchPeopleRankSeriesSettings } from '~~/server/utils/consoleRankSettings'

function text(value: unknown) {
  return String(value || '').trim()
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const activeRoleCode = text(query.activeRoleCode || query.active_role_code)
  await assertPeoplePermission(event, activeRoleCode, 'standard_costs', 'view')

  const settings = await fetchPeopleRankSeriesSettings(event)
  return {
    code: 0,
    message: 'ok',
    data: settings
  }
})
