/**
 * 更新部门文件柜文件（移动到目录、重命名）
 * PATCH /api/dept-cabinet/:id
 */
import { getCabinetFileMetadata, updateCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '文件 ID 不能为空' })
  }

  const body = await readBody(event)
  const { filename, folder_id } = body || {}

  await getCabinetFileMetadata(event, 'department', id)
  const updates: Record<string, unknown> = {}

  if (filename !== undefined) {
    updates.filename = filename
    updates.original_name = filename
  }

  if (folder_id !== undefined) {
    // folder_id 为 null 表示移动到根目录
    updates.folder_id = folder_id
  }

  if (Object.keys(updates).length === 0) {
    return { success: true }
  }

  await updateCabinetFileMetadata(event, 'department', id, updates)

  return { success: true }
})
