import { getConsoleRegions } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { assertRuntimeCompanyCode } from '~~/server/utils/companyRuntimeCompat'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'org_profile', 'view')
  const companyCode = getRouterParam(event, 'companyCode')
  if (!companyCode) throw createError({ statusCode: 400, message: '公司编码不能为空' })
  await assertRuntimeCompanyCode(event, companyCode)

  return await getConsoleRegions(event, { companyCode })
})
