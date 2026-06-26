/**
 * 删除部门文件柜文件夹（仅空文件夹可删除）
 * DELETE /api/dept-cabinet/folders/:id
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface FolderRow {
  id: number
  dept_code?: string | null
  parent_id?: number | null
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '文件夹 ID 不能为空' })
  }

  const folder = await callCodocsTenantRuntime<FolderRow>(event, `/v1/codocs/dept-cabinet/folders/${encodeURIComponent(id)}`, {
    scope: 'codocs.read'
  })

  // 检查子文件夹
  const folders = await callCodocsTenantRuntime<{ items?: FolderRow[] }>(event, '/v1/codocs/dept-cabinet/folders', {
    query: { parent_id: id },
    scope: 'codocs.read'
  })
  if ((folders.items || []).length > 0) {
    throw createError({ statusCode: 400, message: '请先删除子文件夹' })
  }

  // 检查文件夹下是否有文件
  const files = await callCodocsTenantRuntime<{ items?: unknown[] }>(event, '/v1/codocs/dept-cabinet', {
    query: { folder_id: id, dept_code: folder.dept_code },
    scope: 'codocs.read'
  })
  if ((files.items || []).length > 0) {
    throw createError({ statusCode: 400, message: '请先移除文件夹中的文件' })
  }

  await callCodocsTenantRuntime(event, `/v1/codocs/dept-cabinet/folders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    scope: 'codocs.write'
  })

  return { success: true }
})
