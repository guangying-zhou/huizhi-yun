import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['应用管理'],
    summary: '获取用户可访问的应用列表',
    description: '根据 uid 查询该用户有权访问的已启用应用。需要 API Key 认证。',
    parameters: [
      { name: 'uid', in: 'query', required: true, schema: { type: 'string' }, description: '用户 uid' }
    ]
  }
})

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
  await verifyApiKey(event)

  const { uid } = getQuery(event) as { uid?: string }
  if (!uid) {
    throw createError({ statusCode: 400, message: 'Missing uid parameter' })
  }

  const config = useRuntimeConfig()
  const ossImages = config.ossImages as { bucketDomain?: string, bucketName?: string, endpoint?: string }
  // 优先用自定义域名，否则从 bucketName + endpoint 推导 OSS 默认域名
  const bucketDomain = ossImages?.bucketDomain
    || (ossImages?.bucketName && ossImages?.endpoint
      ? `${ossImages.bucketName}.${ossImages.endpoint}`
      : '')

  function resolveIcon(icon: string | null): string | null {
    if (!icon) return null
    // /api/oss/logo?path=logos/xxx.png 或 https://xxx.com/api/oss/logo?path=logos/xxx.png
    // → https://{bucketDomain}/logos/xxx.png
    if (bucketDomain && icon.includes('path=')) {
      const match = icon.match(/path=([^&]+)/)
      if (match?.[1]) return `https://${bucketDomain}/${decodeURIComponent(match[1])}`
    }
    return icon
  }

  const pool = useDbPool()

  const [rows] = await pool.query<AppRow[]>(
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
    data: rows.map(r => ({
      appCode: r.app_code,
      appName: r.app_name,
      description: r.description,
      icon: resolveIcon(r.icon),
      homeUrl: r.home_url,
      appType: r.app_type
    }))
  }
})
