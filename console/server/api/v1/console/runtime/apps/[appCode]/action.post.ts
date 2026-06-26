import { createError, getRouterParams, readBody } from 'h3'
import { z } from 'zod'
import { requirePermission } from '~~/server/utils/checkPermission'
import { applyRuntimeAppAction } from '~~/server/utils/runtimeApps'

const bodySchema = z.object({
  action: z.enum(['start', 'stop', 'restart'])
})

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system_settings', 'admin')

  const appCode = getRouterParams(event).appCode
  if (!appCode) {
    throw createError({ statusCode: 400, message: '缺少应用编码' })
  }
  const body = bodySchema.parse(await readBody(event))
  const result = await applyRuntimeAppAction(appCode, body.action)

  return {
    code: 0,
    data: {
      appCode,
      action: body.action,
      stdout: result.stdout,
      stderr: result.stderr
    }
  }
})
