import { getCabinetFileMetadata, updateCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '文件 ID 不能为空' })
  }

  const body = await readBody(event)
  const { filename, folder_id } = body || {}

  await getCabinetFileMetadata(event, 'personal', id)
  const updates: Record<string, unknown> = {}

  if (filename !== undefined) {
    updates.filename = filename
  }

  if (folder_id !== undefined) {
    updates.folder_id = folder_id
  }

  if (Object.keys(updates).length === 0) {
    return { success: true }
  }

  await updateCabinetFileMetadata(event, 'personal', id, updates)

  return { success: true }
})
