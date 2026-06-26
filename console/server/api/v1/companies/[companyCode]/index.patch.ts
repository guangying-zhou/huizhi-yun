import { updateCompany } from '~~/server/utils/orgCompat'

export default defineEventHandler(async (event) => {
  const companyCode = getRouterParam(event, 'companyCode')
  if (!companyCode) throw createError({ statusCode: 400, message: '公司编码不能为空' })

  const updated = await updateCompany(companyCode, await readBody(event))
  return { code: 0, message: updated ? '更新成功' : '无需更新' }
})
