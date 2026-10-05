/**
 * 获取项目文档列表 API
 * GET /api/documents/project/:projectCode
 */

import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface ProjectDocumentRow {
  id: number
  uuid: string
  title: string
  doc_type: string
  oss_path: string
  owner_uid: string
  dept_code: string | null
  project_code: string | null
  folder_id: number | null
  content_size: number
  last_editor_uid: string | null
  created_at: string
  updated_at: string
  star_flag: number
  home_flag: number
  readonly_flag: number
}

export default defineEventHandler(async (event) => {
  const projectCode = getRouterParam(event, 'projectCode') || event.context.params?.projectCode
  try {
    const data = await callCodocsTenantRuntime<{ items: ProjectDocumentRow[] }>(event, '/v1/codocs/documents', {
      scope: 'codocs.read',
      query: {
        type: 'project',
        project_code: String(projectCode || ''),
        limit: 5000
      }
    })

    return {
      success: true,
      data: (data.items || []).map(row => ({
        type: null,
        id: row.id,
        uuid: row.uuid,
        nodeId: 'doc-' + row.id,
        parentId: row.folder_id,
        name: row.title,
        data: row
      }))
    }
  } catch (error: unknown) {
    console.error('Failed to fetch documents:', error)
    throw createError({
      statusCode: 500,
      message: '获取文档列表失败'
    })
  }
})
