import { getCompany, listRegions } from '~~/server/utils/orgCompat'

export default defineEventHandler(async (event) => {
  const companyCode = getRouterParam(event, 'companyCode')
  if (!companyCode) throw createError({ statusCode: 400, message: '公司编码不能为空' })
  if (!await getCompany(companyCode)) throw createError({ statusCode: 404, message: '公司不存在' })

  const regions = await listRegions()
  return { code: 0, data: regions.map(region => ({ ...region, companyCode })) }
})
