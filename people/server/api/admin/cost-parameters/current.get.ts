import { getQuery } from 'h3'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'
import { fetchFinanceCostParameters } from '~~/server/utils/financeCostParameters'

function text(value: unknown) {
  return String(value || '').trim()
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const activeRoleCode = text(query.activeRoleCode || query.active_role_code)
  await assertPeoplePermission(event, activeRoleCode, 'standard_costs', 'view')

  const effectiveDate = text(query.effectiveDate || query.effective_date)
  const parameters = await fetchFinanceCostParameters(event, effectiveDate)
  return {
    code: 0,
    message: 'ok',
    data: parameters
  }
})
