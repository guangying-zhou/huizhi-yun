import { useDatabase } from '../../utils/database'
import { logOperationFromEvent } from '../../utils/log'
import type { RowDataPacket } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: '应用ID不能为空' })
  }

  try {
    const [existing] = await pool.query<RowDataPacket[]>('SELECT id, app_code, app_name FROM applications WHERE id = ?', [id])

    if (existing.length === 0) {
      throw createError({ statusCode: 404, message: '应用不存在' })
    }

    // 删除访问规则
    await pool.query('DELETE FROM app_access_rules WHERE app_id = ?', [id])
    // 删除应用
    await pool.query('DELETE FROM applications WHERE id = ?', [id])

    if (existing[0]) {
      await logOperationFromEvent(event, {
        sourceApp: 'account',
        action: 'application.delete',
        targetType: 'application',
        targetId: existing[0].app_code,
        detail: {
          id: Number(id),
          appName: existing[0].app_name
        }
      })
    }

    return { code: 0, message: '删除成功', data: null }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    console.error('删除应用失败:', error)
    throw createError({ statusCode: 500, message: error.message || '删除应用失败' })
  }
})
