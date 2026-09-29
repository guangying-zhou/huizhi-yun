import { defineEventHandler, setHeader } from 'h3'
import { organizationQuery, currentOrganization, fetchOrganizationRead, projectOrganizationList } from '../../../../../utils/consoleOrganizationRead'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  organizationQuery(event)
  const company = await currentOrganization(event)
  const rows = await fetchOrganizationRead(event, 'organization.regions.list', { companyCode: company.companyCode })
  return { code: 0, data: projectOrganizationList(rows, company, 'regions') }
})
