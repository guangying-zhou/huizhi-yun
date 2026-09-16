import { getConsoleRegionDivisions } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { assertRuntimeCompanyCode } from '~~/server/utils/companyRuntimeCompat'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'org_profile', 'view')
  const companyCode = getRouterParam(event, 'companyCode')
  const regionCode = getRouterParam(event, 'regionCode')
  if (!companyCode || !regionCode) throw createError({ statusCode: 400, message: '公司编码和区域编码不能为空' })
  await assertRuntimeCompanyCode(event, companyCode)

  return await getConsoleRegionDivisions(event, regionCode)
})
