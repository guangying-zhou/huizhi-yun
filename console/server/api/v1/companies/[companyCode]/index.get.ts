import { getLegacyRuntimeCompany } from '~~/server/utils/companyRuntimeCompat'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'org_profile', 'view')
  const companyCode = getRouterParam(event, 'companyCode')
  if (!companyCode) throw createError({ statusCode: 400, message: '公司编码不能为空' })

  const company = await getLegacyRuntimeCompany(event)
  if (company.companyCode !== companyCode) throw createError({ statusCode: 404, message: '公司不存在' })
  return { code: 0, data: company }
})
