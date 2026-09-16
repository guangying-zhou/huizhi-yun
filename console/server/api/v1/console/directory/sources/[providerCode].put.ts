import { readBody } from 'h3'
import { upsertConsoleDirectorySource } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { requireIdempotencyKey } from '~~/server/utils/idempotency'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sources', 'edit', '需要目录源配置编辑权限')
  requireIdempotencyKey(event, '保存目录源必须提供 Idempotency-Key。')

  const providerCode = getRouterParam(event, 'providerCode')
  if (!providerCode) throw createError({ statusCode: 400, message: 'providerCode is required' })

  const body = await readBody<Record<string, unknown>>(event)
  return await upsertConsoleDirectorySource(event, providerCode, body)
})
