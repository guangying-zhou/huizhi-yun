/**
 * 获取当前用户有权访问的应用列表
 * GET /api/user/applications
 *
 * 访问规则（基于 applications.access_scope）：
 * - all：所有用户可访问
 * - department：用户所属部门在 app_access_rules 中
 * - user：用户 uid 在 app_access_rules 中
 */
import { queryRows } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface AppRow extends RowDataPacket {
  id: number
  app_code: string
  app_name: string
  description: string | null
  icon: string | null
  home_url: string | null
  app_type: string
}

export default defineEventHandler(async (event) => {
  const uid = getCookie(event, 'auth_user')
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  try {
    const config = useRuntimeConfig()
    const ossImages = config.ossImages as { bucketDomain?: string, bucketName?: string, endpoint?: string }
    const bucketDomain = ossImages?.bucketDomain
      || (ossImages?.bucketName && ossImages?.endpoint
        ? `${ossImages.bucketName}.${ossImages.endpoint}`
        : '')

    function resolveIcon(icon: string | null): string | null {
      if (!icon) return null
      if (bucketDomain && icon.includes('path=')) {
        const match = icon.match(/path=([^&]+)/)
        if (match?.[1]) return `https://${bucketDomain}/${decodeURIComponent(match[1])}`
      }
      return icon
    }

    const apps = await queryRows<AppRow[]>(
      `SELECT DISTINCT a.id, a.app_code, a.app_name, a.description, a.icon, a.home_url, a.app_type
       FROM applications a
       WHERE a.status = 1 AND (
         a.access_scope = 'all'
         OR (a.access_scope = 'user' AND EXISTS (
           SELECT 1 FROM app_access_rules r
           WHERE r.app_id = a.id AND r.rule_type = 'user' AND r.target_id = ?
         ))
         OR (a.access_scope = 'department' AND EXISTS (
           SELECT 1 FROM app_access_rules r
           INNER JOIN user_departments ud ON ud.dept_code = r.target_id
           WHERE r.app_id = a.id AND r.rule_type = 'department' AND ud.uid = ?
         ))
       )
       ORDER BY a.app_name`,
      [uid, uid]
    )

    return {
      code: 0,
      data: apps.map(app => ({
        appCode: app.app_code,
        appName: app.app_name,
        description: app.description,
        icon: resolveIcon(app.icon),
        homeUrl: app.home_url,
        appType: app.app_type
      }))
    }
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('[User Applications] Failed to query:', error.message)
    throw createError({
      statusCode: 500,
      message: '获取应用列表失败'
    })
  }
})
