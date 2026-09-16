import { updateConsoleTenantProfile } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getHeader } from 'h3'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'org_profile', 'edit')
  if (!String(getHeader(event, 'idempotency-key') || '').trim()) {
    throw createError({
      statusCode: 400,
      message: '保存企业资料必须提供 Idempotency-Key。'
    })
  }
  return await updateConsoleTenantProfile(event, await readBody(event))
})
