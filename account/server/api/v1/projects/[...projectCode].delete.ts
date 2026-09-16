import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import type { ResultSetHeader } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['项目管理'],
    summary: '删除项目',
    description: '软删除项目。需要 API Key 认证。',
    parameters: [
      { in: 'path', name: 'projectCode', required: true, schema: { type: 'string' }, description: '项目编码' }
    ]
  }
})

export default defineEventHandler(async (event) => {
  // Verify API key
  await verifyApiKey(event)

  const projectCode = decodeURIComponent(getRouterParam(event, 'projectCode') || '')
  const pool = useDbPool()

  try {
    // Soft delete: update status to 0
    const [result] = await pool.query<ResultSetHeader>(
      'UPDATE git_projects SET status = 0 WHERE project_code = ?',
      [projectCode]
    )

    if (result.affectedRows === 0) {
      throw createError({
        statusCode: 404,
        message: 'Project not found'
      })
    }

    return {
      code: 0,
      message: 'success',
      data: {
        projectCode
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to delete project:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to delete project'
    })
  }
})
