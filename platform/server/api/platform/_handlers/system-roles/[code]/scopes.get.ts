import type { H3Event } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRows } from '~~/server/utils/db'

interface ScopeRow extends RowDataPacket {
  id: number
  app_code: string
  resource_code: string
  resource_name: string
  action: string
  manifest_action_id: number | null
  scope_type: string
  scope_value: string
  status: string
}

function requireCode(event: H3Event) {
  const code = String(getRouterParam(event, 'code') || '').trim()
  if (!code) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'code is required'
    })
  }
  return code
}

export default defineEventHandler(async (event) => {
  const code = requireCode(event)
  const rows = await queryRows<ScopeRow[]>(
    `SELECT psrs.id,
            psrs.app_code,
            psrs.resource_code,
            COALESCE(source_mr.resource_name, latest_mr.resource_name, psrs.resource_code) AS resource_name,
            psrs.action,
            psrs.manifest_action_id,
            psrs.scope_type,
            psrs.scope_value,
            psrs.status
     FROM platform_app_role_scopes psrs
     INNER JOIN platform_app_roles psr
       ON psr.id = psrs.app_role_id
     LEFT JOIN platform_app_manifest_resource_actions source_mra
       ON source_mra.id = psrs.manifest_action_id
     LEFT JOIN platform_app_manifest_resources source_mr
       ON source_mr.id = source_mra.manifest_resource_id
     LEFT JOIN platform_applications pa
       ON pa.app_code = psrs.app_code
     LEFT JOIN platform_app_manifest_resources latest_mr
       ON latest_mr.app_code = psrs.app_code
      AND latest_mr.manifest_id = pa.latest_manifest_id
      AND latest_mr.resource_code = psrs.resource_code
     WHERE psr.role_code = ?
     ORDER BY psrs.app_code ASC, psrs.resource_code ASC, psrs.action ASC, psrs.scope_type ASC, psrs.scope_value ASC`,
    [code]
  )

  return ok({
    roleCode: code,
    items: rows.map(row => ({
      id: row.id,
      appCode: row.app_code,
      resourceCode: row.resource_code,
      resourceName: row.resource_name,
      action: row.action,
      manifestActionId: row.manifest_action_id,
      scopeType: row.scope_type,
      scopeValue: row.scope_value,
      status: row.status
    })),
    total: rows.length
  })
})
