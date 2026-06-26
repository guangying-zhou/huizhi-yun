import { getCompany } from '~~/server/utils/orgCompat'

export default defineEventHandler(async (event) => {
  const companyCode = getRouterParam(event, 'companyCode')
  if (!companyCode) throw createError({ statusCode: 400, message: '公司编码不能为空' })

  const company = await getCompany(companyCode)
  if (!company) throw createError({ statusCode: 404, message: '公司不存在' })
  return { code: 0, data: company }
})
