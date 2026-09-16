import { getLegacyRuntimeCompany, updateLegacyRuntimeCompany } from '~~/server/utils/companyRuntimeCompat'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'edit')

  const current = await getLegacyRuntimeCompany(event)
  const result = await updateLegacyRuntimeCompany(event, current.companyCode, await readBody(event))
  return {
    ...result,
    message: result.replayed ? '请求已处理' : '企业资料已更新',
    data: { id: null, companyCode: current.companyCode, profile: result.data }
  }
})
