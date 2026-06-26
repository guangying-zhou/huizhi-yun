import { createRegion, getCompany, initRegionsFromStandardTemplate } from '~~/server/utils/orgCompat'

export default defineEventHandler(async (event) => {
  const companyCode = getRouterParam(event, 'companyCode')
  if (!companyCode) throw createError({ statusCode: 400, message: '公司编码不能为空' })
  if (!await getCompany(companyCode)) throw createError({ statusCode: 404, message: '公司不存在' })

  const query = getQuery(event)
  if (query.fromTemplate === 'STANDARD_7') {
    await initRegionsFromStandardTemplate()
    return { code: 0, message: '初始化成功' }
  }

  await createRegion(await readBody(event))
  return { code: 0, message: '创建成功' }
})
