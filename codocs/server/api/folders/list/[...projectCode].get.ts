/**
 * 获取文件夹列表 API
 * GET /api/folders
 */

import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface FolderRow {
  id: number
  name: string
  folder_type: string
  owner_uid: string
  dept_code: string | null
  project_code: string | null
  parent_id: number | null
  sort_order: number
  created_at: string
  updated_at: string
}

export default defineEventHandler(async (event) => {
  const projectCode = decodeURIComponent(getRouterParam(event, 'projectCode') || '')
  if (!projectCode) {
    throw createError({
      statusCode: 400,
      message: '缺少项目ID'
    })
  }
  try {
    const data = await callCodocsTenantRuntime<{ items?: FolderRow[] }>(event, '/v1/codocs/folders', {
      query: { folder_type: 'project', project_code: projectCode },
      scope: 'codocs.read'
    })
    const rows = data.items || []

    return {
      success: true,
      data: rows.map(row => ({
        type: null,
        id: row.id,
        nodeId: 'folder-' + row.id,
        parentId: row.parent_id,
        name: row.name,
        data: row
      }))
    }
  } catch (error: unknown) {
    console.error('Failed to fetch folders:', error)
    throw createError({
      statusCode: 500,
      message: '获取文件夹列表失败'
    })
  }
})
