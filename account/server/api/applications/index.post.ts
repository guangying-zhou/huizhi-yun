import { useDatabase } from '../../utils/database'
import { randomBytes } from 'crypto'
import { logOperationFromEvent } from '../../utils/log'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const body = await readBody(event)

  const { app_code, app_name, description, icon, home_url, callback_url, logout_url, app_type, sso_type, access_scope = 'all' } = body

  if (!app_code || !app_name) {
    throw createError({
      statusCode: 400,
      message: '应用编码和应用名称不能为空'
    })
  }

  try {
    // 检查应用编码是否已存在
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM applications WHERE app_code = ?',
      [app_code]
    )

    if (existing.length > 0) {
      throw createError({
        statusCode: 400,
        message: '应用编码已存在'
      })
    }

    // 生成应用密钥
    const app_secret = randomBytes(32).toString('hex')

    // 创建应用
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO applications (app_code, app_name, description, icon, home_url, callback_url, logout_url, app_secret, app_type, sso_type, access_scope, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [app_code, app_name, description || null, icon || null, home_url || null, callback_url || null, logout_url || null, app_secret, app_type || 'internal', sso_type || null, access_scope]
    )

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'application.create',
      targetType: 'application',
      targetId: app_code,
      detail: {
        id: result.insertId,
        appCode: app_code,
        appName: app_name,
        appType: app_type || 'internal',
        accessScope: access_scope
      }
    })

    return {
      code: 0,
      message: '创建成功',
      data: {
        id: result.insertId,
        app_code,
        app_name,
        app_secret // 只在创建时返回密钥
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('创建应用失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '创建应用失败'
    })
  }
})
