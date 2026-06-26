import { updateCompanyBusinessDomain } from '~~/server/utils/businessDomains'
import { getCompany } from '~~/server/utils/orgCompat'

export default defineEventHandler(async (event) => {
  const companyCode = getRouterParam(event, 'companyCode')
  const domainCode = getRouterParam(event, 'domainCode')
  if (!companyCode || !domainCode) {
    throw createError({ statusCode: 400, message: '公司编码和领域编码不能为空' })
  }
  if (!await getCompany(companyCode)) throw createError({ statusCode: 404, message: '公司不存在' })

  const updated = await updateCompanyBusinessDomain(domainCode, await readBody(event))
  return {
    code: 0,
    message: updated ? '更新成功' : '无需更新'
  }
})
