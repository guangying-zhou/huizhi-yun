import { useDatabase } from '../../utils/database'
import { logOperationFromEvent } from '../../utils/log'
import type { RowDataPacket } from 'mysql2/promise'

interface ApplicationRow extends RowDataPacket {
  id: number
  app_code: string
  app_name: string
}

export default defineEventHandler(async (event) => {
  const pool = useDatabase()
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  if (!id) {
    throw createError({
      statusCode: 400,
      message: '应用ID不能为空'
    })
  }

  const { app_name, description, icon, home_url, callback_url, logout_url, app_type, sso_type, access_scope, status } = body

  try {
    const [existing] = await pool.query<ApplicationRow[]>(
      'SELECT id, app_code, app_name FROM applications WHERE id = ?',
      [id]
    )

    if (existing.length === 0) {
      throw createError({
        statusCode: 404,
        message: '应用不存在'
      })
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (app_name !== undefined) {
      updates.push('app_name = ?')
      params.push(app_name)
    }
    if (description !== undefined) {
      updates.push('description = ?')
      params.push(description)
    }
    if (icon !== undefined) {
      updates.push('icon = ?')
      params.push(icon)
    }
    if (home_url !== undefined) {
      updates.push('home_url = ?')
      params.push(home_url)
    }
    if (callback_url !== undefined) {
      updates.push('callback_url = ?')
      params.push(callback_url)
    }
    if (logout_url !== undefined) {
      updates.push('logout_url = ?')
      params.push(logout_url)
    }
    if (app_type !== undefined) {
      updates.push('app_type = ?')
      params.push(app_type)
    }
    if (sso_type !== undefined) {
      updates.push('sso_type = ?')
      params.push(sso_type)
    }
    if (access_scope !== undefined) {
      updates.push('access_scope = ?')
      params.push(access_scope)
    }
    if (status !== undefined) {
      updates.push('status = ?')
      params.push(status)
    }

    if (updates.length === 0) {
      return { code: 0, message: '无需更新', data: null }
    }

    params.push(id)
    await pool.query(`UPDATE applications SET ${updates.join(', ')} WHERE id = ?`, params)

    if (existing[0]) {
      await logOperationFromEvent(event, {
        sourceApp: 'account',
        action: 'application.update',
        targetType: 'application',
        targetId: existing[0].app_code,
        detail: {
          id: Number(id),
          appName: existing[0].app_name,
          changes: body
        }
      })
    }

    return { code: 0, message: '更新成功', data: { id } }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('更新应用失败:', error)
    throw createError({ statusCode: 500, message: error.message || '更新应用失败' })
  }
})
