/**
 * 重命名部门文件柜文件夹
 * PATCH /api/dept-cabinet/folders/:id
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { requireDepartmentManagerAccess } from '~~/server/utils/departmentAccess'

interface FolderRow {
  id: number
  dept_code: string
  parent_id: number | null
  name?: string
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '文件夹 ID 不能为空' })
  }

  const actorUid = requireRequestUid(event)
  const body = await readBody(event)
  const { name } = body || {}

  if (!name?.trim()) {
    throw createError({ statusCode: 400, message: '文件夹名称不能为空' })
  }

  const folder = await callCodocsTenantRuntime<FolderRow>(event, `/v1/codocs/dept-cabinet/folders/${encodeURIComponent(id)}`, {
    scope: 'codocs.read'
  })
  await requireDepartmentManagerAccess(event, actorUid, folder.dept_code, '仅部门经理可修改部门文件柜目录')

  const folderPage = await callCodocsTenantRuntime<{ items?: FolderRow[] }>(event, '/v1/codocs/dept-cabinet/folders', {
    query: { dept_code: folder.dept_code },
    scope: 'codocs.read'
  })
  const existing = (folderPage.items || []).find(item =>
    String(item.id) !== String(id) && item.name === name.trim() && String(item.parent_id || '') === String(folder.parent_id || '')
  )
  if (existing) {
    throw createError({ statusCode: 409, message: '同级目录下已存在同名文件夹' })
  }

  await callCodocsTenantRuntime(event, `/v1/codocs/dept-cabinet/folders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    scope: 'codocs.write',
    body: { name: name.trim() }
  })

  return { success: true }
})
