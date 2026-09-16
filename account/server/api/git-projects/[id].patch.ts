import { useDbPool } from '~~/server/utils/db'
import { logOperationFromEvent } from '~~/server/utils/log'
import type { RowDataPacket } from 'mysql2/promise'

interface UpdateProjectBody {
  name?: string
  leaderUid?: string | null
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  repoUrl?: string | null
  status?: number
  isTemplate?: number
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<UpdateProjectBody>(event)
  const pool = useDbPool()

  if (!id) {
    throw createError({
      statusCode: 400,
      message: '缺少项目ID'
    })
  }

  try {
    const [existingRows] = await pool.query<RowDataPacket[]>(
      'SELECT id, project_code, name FROM git_projects WHERE id = ?',
      [id]
    )

    if (existingRows.length === 0) {
      throw createError({
        statusCode: 404,
        message: '项目不存在'
      })
    }

    const updates: string[] = []
    const params: (string | number | null)[] = []

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

    if (body.startDate !== undefined) {
      updates.push('start_date = ?')
      params.push(body.startDate || null)
    }

    if (body.endDate !== undefined) {
      updates.push('end_date = ?')
      params.push(body.endDate || null)
    }

    if (body.repoUrl !== undefined) {
      updates.push('repo_url = ?')
      params.push(body.repoUrl || null)
    }

    if (body.status !== undefined) {
      updates.push('status = ?')
      params.push(body.status)
    }

    if (body.isTemplate !== undefined) {
      updates.push('is_template = ?')
      params.push(body.isTemplate)
    }

    if (updates.length === 0) {
      throw createError({
        statusCode: 400,
        message: '没有提供需要更新的字段'
      })
    }

    params.push(id)
    await pool.query(
      `UPDATE git_projects SET ${updates.join(', ')} WHERE id = ?`,
      params
    )

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'project.update',
      targetType: 'project',
      targetId: existingRows[0]?.project_code as string,
      detail: {
        id: Number(id),
        name: existingRows[0]?.name,
        changes: body
      }
    })

    return {
      success: true,
      message: '更新成功'
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to update project:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to update project'
    })
  }
})
