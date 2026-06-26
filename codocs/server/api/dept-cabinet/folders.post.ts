/**
 * 创建部门文件柜文件夹
 * POST /api/dept-cabinet/folders
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface FolderRow {
  id: number
  name?: string
  parent_id?: number | null
  dept_code?: string | null
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { name, dept_code, parent_id, owner_uid } = body || {}

  if (!name?.trim()) {
    throw createError({ statusCode: 400, message: '文件夹名称不能为空' })
  }

  if (!dept_code) {
    throw createError({ statusCode: 400, message: 'dept_code 不能为空' })
  }

  if (!owner_uid) {
    throw createError({ statusCode: 400, message: 'owner_uid 不能为空' })
  }

  const parentIdValue = parent_id || null
  const folderPage = await callCodocsTenantRuntime<{ items?: FolderRow[] }>(event, '/v1/codocs/dept-cabinet/folders', {
    query: { dept_code },
    scope: 'codocs.read'
  })
  const existing = (folderPage.items || []).find(folder =>
    folder.name === name.trim() && String(folder.parent_id || '') === String(parentIdValue || '')
  )
  if (existing) {
    throw createError({ statusCode: 409, message: '同级目录下已存在同名文件夹' })
  }

  const result = await callCodocsTenantRuntime<FolderRow>(event, '/v1/codocs/dept-cabinet/folders', {
    method: 'POST',
    scope: 'codocs.write',
    body: {
      name: name.trim(),
      parent_id: parentIdValue,
      owner_uid,
      dept_code
    }
  })

  return {
    success: true,
    data: {
      id: result.id,
      name: name.trim(),
      parent_id: parentIdValue
    }
  }
})
