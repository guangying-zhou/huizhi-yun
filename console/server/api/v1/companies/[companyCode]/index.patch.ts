import { updateLegacyRuntimeCompany } from '~~/server/utils/companyRuntimeCompat'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'edit')

  const companyCode = getRouterParam(event, 'companyCode')
  if (!companyCode) throw createError({ statusCode: 400, message: '公司编码不能为空' })

  const result = await updateLegacyRuntimeCompany(event, companyCode, await readBody(event))
  return { ...result, message: result.replayed ? '请求已处理' : '更新成功' }
})
