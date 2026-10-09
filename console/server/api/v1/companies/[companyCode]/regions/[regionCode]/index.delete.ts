import { deleteConsoleRegion } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { assertRuntimeCompanyCode } from '~~/server/utils/companyRuntimeCompat'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'edit')
  requireIdempotencyKey(event)

  const companyCode = getRouterParam(event, 'companyCode')
  const regionCode = getRouterParam(event, 'regionCode')
  if (!companyCode || !regionCode) throw createError({ statusCode: 400, message: '公司编码和区域编码不能为空' })
  await assertRuntimeCompanyCode(event, companyCode)

  return await deleteConsoleRegion(event, regionCode, await readBody(event))
})
