import type { RowDataPacket } from 'mysql2/promise'
import { ok, requireString } from '~~/server/utils/api'
import { queryRow } from '~~/server/utils/db'
import { findEffectiveManifestByAppCode } from '~~/server/utils/platform'

export default defineEventHandler(async (event) => {
  const appCode = requireString(getRouterParam(event, 'appCode'), 'appCode')
  const tenantCode = requireString(getQuery(event).tenantCode, 'tenantCode')

  const subscription = await queryRow<RowDataPacket>(
    `SELECT id
     FROM subscriptions
     WHERE tenant_code = ?
       AND app_code = ?
       AND status = 'active'
     LIMIT 1`,
    [tenantCode, appCode]
  )

  if (!subscription) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `active subscription not found: tenantCode=${tenantCode}, appCode=${appCode}`
    })
  }

  const manifest = await findEffectiveManifestByAppCode(appCode)

  if (!manifest) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `manifest not found for appCode=${appCode}`
    })
  }

  return ok({
    appCode: manifest.app_code,
    version: manifest.version,
    manifestHash: manifest.manifest_hash,
    manifestJson: manifest.manifest_json,
    createdAt: manifest.created_at
  })
})
