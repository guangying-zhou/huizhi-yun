import { createConsoleBusinessDomains } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { assertRuntimeCompanyCode } from '~~/server/utils/companyRuntimeCompat'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'edit')
  requireIdempotencyKey(event)

  const companyCode = getRouterParam(event, 'companyCode')
  if (!companyCode) throw createError({ statusCode: 400, message: '公司编码不能为空' })
  await assertRuntimeCompanyCode(event, companyCode)

  return await createConsoleBusinessDomains(event, await readBody(event))
})
