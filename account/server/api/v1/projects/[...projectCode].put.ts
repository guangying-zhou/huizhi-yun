import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'

defineRouteMeta({
  openAPI: {
    tags: ['项目管理'],
    summary: '更新项目',
    description: '更新项目信息。需要 API Key 认证。',
    parameters: [
      { in: 'path', name: 'projectCode', required: true, schema: { type: 'string' }, description: '项目编码' }
    ]
  }
})

interface UpdateProjectBody {
  name?: string
  leaderUid?: string
  description?: string
  status?: number
  isGroup?: number
  isTemplate?: number
  members?: Array<{
    uid: string
    role: 'member' | 'admin'
  }>
}

export default defineEventHandler(async (event) => {
  // Verify API key
  await verifyApiKey(event)

  const projectCode = decodeURIComponent(getRouterParam(event, 'projectCode') || '')
  const body = await readBody<UpdateProjectBody>(event)
  const pool = useDbPool()

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    // 1. Update Project Fields
    const updates: string[] = []
    const params: unknown[] = []

    if (body.name !== undefined) {
      updates.push('name = ?')
      params.push(body.name)
    }

    if (body.leaderUid !== undefined) {
      updates.push('leader_uid = ?')
      params.push(body.leaderUid || null)
    }

    if (body.description !== undefined) {
      updates.push('description = ?')
      params.push(body.description || null)
    }

    if (body.status !== undefined) {
      updates.push('status = ?')
      params.push(body.status)
    }

    if (body.isGroup !== undefined) {
      updates.push('is_group = ?')
      params.push(body.isGroup)
    }

    if (body.isTemplate !== undefined) {
      updates.push('is_template = ?')
      params.push(body.isTemplate)
    }

    if (updates.length > 0) {
      params.push(projectCode)
      await connection.query(
        `UPDATE git_projects SET ${updates.join(', ')} WHERE project_code = ?`,
        params
      )
    }

    // 2. Sync Members (if provided)
    if (body.members) {
      // Delete existing members
      await connection.query(
        'DELETE FROM git_project_members WHERE project_code = ?',
        [projectCode]
      )

      // Insert new members
      if (body.members.length > 0) {
        const values = body.members.map(m => [
          projectCode,
          m.uid,
          m.role || 'member'
        ])

        await connection.query(
          'INSERT INTO git_project_members (project_code, uid, role) VALUES ?',
          [values]
        )
      }
    }

    await connection.commit()

    return {
      code: 0,
      message: 'success',
      data: {
        projectCode
      }
    }
  } catch (err: unknown) {
    const error = err as { message?: string }
    await connection.rollback()

    console.error('Failed to update project:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to update project'
    })
  } finally {
    connection.release()
  }
})
