import { updateConsoleSettingValue } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getHeader, getRouterParam, readBody } from 'h3'
import type { H3Event } from 'h3'
import { requirePermission } from '~~/server/utils/checkPermission'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'
import { requireSystemSettingsAccess } from '~~/server/utils/systemSettingsAccess'

async function requireSettingEditAccess(event: H3Event, settingKey: string) {
  if (settingKey.startsWith('dataRuntime.')) {
    await requirePermission(event, 'data_runtime', 'edit')
    return {
      actorId: await requireConsoleRequestUid(event)
    }
  }
  return await requireSystemSettingsAccess(event, 'edit')
}

export default defineEventHandler(async (event) => {
  const settingKey = getRouterParam(event, 'settingKey') || ''
  await requireSettingEditAccess(event, settingKey)
  if (!String(getHeader(event, 'idempotency-key') || '').trim()) {
    throw createError({ statusCode: 400, message: '保存系统参数必须提供 Idempotency-Key。' })
  }
  const body = await readBody<{
    scopeKey?: string
    value?: unknown
    expectedRevision?: number
  }>(event)

  return await updateConsoleSettingValue(event, settingKey, body)
})
