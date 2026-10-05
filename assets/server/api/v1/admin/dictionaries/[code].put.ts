import { ok, readRequestBody } from '~~/server/utils/assetsApi'
import { updateDictionary } from '~~/server/utils/dictionaryRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin', 'admin')

  const code = event.context.params?.code
  if (!code) {
    throw createError({ statusCode: 400, message: '缺少字典编码' })
  }

  const payload = await readRequestBody<Record<string, unknown>>(event)
  const item = await updateDictionary(code, payload)

  return ok(item, '字典已更新')
})
