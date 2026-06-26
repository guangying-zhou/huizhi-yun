import { getCompany, updateRegion } from '~~/server/utils/orgCompat'

export default defineEventHandler(async (event) => {
  const companyCode = getRouterParam(event, 'companyCode')
  const regionCode = getRouterParam(event, 'regionCode')
  if (!companyCode || !regionCode) throw createError({ statusCode: 400, message: '公司编码和区域编码不能为空' })
  if (!await getCompany(companyCode)) throw createError({ statusCode: 404, message: '公司不存在' })

  const updated = await updateRegion(regionCode, await readBody(event))
  return { code: 0, message: updated ? '更新成功' : '无需更新' }
})
