import { getCompany, replaceRegionDivisions } from '~~/server/utils/orgCompat'

export default defineEventHandler(async (event) => {
  const companyCode = getRouterParam(event, 'companyCode')
  const regionCode = getRouterParam(event, 'regionCode')
  if (!companyCode || !regionCode) throw createError({ statusCode: 400, message: '公司编码和区域编码不能为空' })
  if (!await getCompany(companyCode)) throw createError({ statusCode: 404, message: '公司不存在' })

  const body = await readBody<{ divisions?: { divisionCode: string, divisionName?: string, includeChildren?: boolean }[] }>(event)
  await replaceRegionDivisions(regionCode, body.divisions)
  return { code: 0, message: `已设置 ${body.divisions?.length || 0} 个行政区划` }
})
