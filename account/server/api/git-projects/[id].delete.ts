import { useDbPool } from '~~/server/utils/db'
import { logOperationFromEvent } from '~~/server/utils/log'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const pool = useDbPool()

  if (!id) {
    throw createError({
      statusCode: 400,
      message: '缺少项目ID'
    })
  }

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    const [projectRows] = await connection.query<RowDataPacket[]>(
      'SELECT id, project_code, name FROM git_projects WHERE id = ?',
      [id]
    )

    if (projectRows.length === 0) {
      throw createError({
        statusCode: 404,
        message: '项目不存在'
      })
    }

    // Delete project members first
    await connection.query(
      'DELETE FROM git_project_members WHERE project_code = (SELECT project_code FROM git_projects WHERE id = ?)',
      [id]
    )

    // Delete project
    await connection.query(
      'DELETE FROM git_projects WHERE id = ?',
      [id]
    )

    await connection.commit()

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'project.delete',
      targetType: 'project',
      targetId: projectRows[0]?.project_code as string,
      detail: {
        id: Number(id),
        name: projectRows[0]?.name
      }
    })

    return {
      success: true,
      message: '删除成功'
    }
  } catch (err: unknown) {
    await connection.rollback()
    const error = err as { message?: string }
    console.error('Failed to delete project:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to delete project'
    })
  } finally {
    connection.release()
  }
})
