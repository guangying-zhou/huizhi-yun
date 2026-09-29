import { createError, defineEventHandler, setHeader } from 'h3'
import { organizationQuery, organizationRegionCode, currentOrganization, fetchOrganizationRead, projectOrganizationList, projectRegionDivisions } from '../../../../../../utils/consoleOrganizationRead'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  organizationQuery(event)
  const regionCode = organizationRegionCode(event)
  const company = await currentOrganization(event)
  const params = { companyCode: company.companyCode }
  const regions = projectOrganizationList(await fetchOrganizationRead(event, 'organization.regions.list', params), company, 'regions')
  if (!regions.regions.some(region => region.regionCode === regionCode)) throw createError({ statusCode: 404, message: 'Region not found' })
  const rows = await fetchOrganizationRead(event, 'organization.regions.divisions.list', { ...params, regionCode })
  return { code: 0, data: { items: projectRegionDivisions(rows) } }
})
