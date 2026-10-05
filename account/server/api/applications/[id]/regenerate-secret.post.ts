import { useDatabase } from '../../../utils/database'
import { randomBytes } from 'crypto'
import { logOperationFromEvent } from '../../../utils/log'
import type { RowDataPacket } from 'mysql2/promise'

interface ApplicationRow extends RowDataPacket {
  id: number
  app_code: string
  app_name: string
}

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: '应用ID不能为空' })
  }

  try {
    const [existing] = await pool.query<ApplicationRow[]>('SELECT id, app_code, app_name FROM applications WHERE id = ?', [id])

    if (existing.length === 0) {
      throw createError({ statusCode: 404, message: '应用不存在' })
    }

    // 生成新密钥
    const app_secret = randomBytes(32).toString('hex')

    await pool.query('UPDATE applications SET app_secret = ? WHERE id = ?', [app_secret, id])

    if (existing[0]) {
      await logOperationFromEvent(event, {
        sourceApp: 'account',
        action: 'application.secret.regenerate',
        targetType: 'application',
        targetId: existing[0].app_code,
        detail: {
          id: Number(id),
          appName: existing[0].app_name
        }
      })
    }

    return {
      code: 0,
      message: '密钥重置成功',
      data: { app_secret }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('重置密钥失败:', error)
    throw createError({ statusCode: 500, message: error.message || '重置密钥失败' })
  }
})
