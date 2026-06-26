import { getCompany, listRegionDivisions } from '~~/server/utils/orgCompat'

export default defineEventHandler(async (event) => {
  const companyCode = getRouterParam(event, 'companyCode')
  const regionCode = getRouterParam(event, 'regionCode')
  if (!companyCode || !regionCode) throw createError({ statusCode: 400, message: '公司编码和区域编码不能为空' })
  if (!await getCompany(companyCode)) throw createError({ statusCode: 404, message: '公司不存在' })

  return { code: 0, data: await listRegionDivisions(regionCode) }
})
