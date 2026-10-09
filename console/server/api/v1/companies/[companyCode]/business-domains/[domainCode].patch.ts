import { updateConsoleBusinessDomain } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { assertRuntimeCompanyCode } from '~~/server/utils/companyRuntimeCompat'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

export default defineEventHandler(async (event) => {
  await requireSystemSettingsAccess(event, 'edit')
  requireIdempotencyKey(event)

  const companyCode = getRouterParam(event, 'companyCode')
  const domainCode = getRouterParam(event, 'domainCode')
  if (!companyCode || !domainCode) {
    throw createError({ statusCode: 400, message: '公司编码和领域编码不能为空' })
  }
  await assertRuntimeCompanyCode(event, companyCode)

  return await updateConsoleBusinessDomain(event, domainCode, await readBody(event))
})
