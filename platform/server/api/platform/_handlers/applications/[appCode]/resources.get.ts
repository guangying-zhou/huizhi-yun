import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { queryRows } from '~~/server/utils/db'

interface ResourceActionRow extends RowDataPacket {
  manifest_id: number
  manifest_seq: number
  resource_id: number
  resource_code: string
  resource_name: string
  resource_description: string | null
  resource_sort_order: number
  action_id: number | null
  action: string | null
  action_code: string | null
  action_name: string | null
  action_description: string | null
  action_sort_order: number | null
  requires_grant: number | null
}

export default defineEventHandler(async (event) => {
  const appCode = requireString(getRouterParam(event, 'appCode'), 'appCode')
  const query = getQuery(event)
  const grant = normalizeNullableString(query.requiresGrant)

  const where = ['mr.status = \'active\'']
  const params: Array<string | number> = [appCode]

  if (grant === 'true') {
    where.push('mra.requires_grant = 1')
  } else if (grant === 'false') {
    where.push('mra.requires_grant = 0')
  }

  const rows = await queryRows<ResourceActionRow[]>(
    `SELECT mr.manifest_id,
            pam.manifest_seq,
            mr.id AS resource_id,
            mr.resource_code,
            mr.resource_name,
            mr.description AS resource_description,
            mr.sort_order AS resource_sort_order,
            mra.id AS action_id,
            mra.action,
            mra.action_code,
            mra.action_name,
            mra.description AS action_description,
            mra.sort_order AS action_sort_order,
            mra.requires_grant
     FROM platform_applications pa
     INNER JOIN platform_app_manifests pam
       ON pam.id = COALESCE(
         (SELECT par.manifest_id
          FROM platform_app_releases par
          WHERE par.id = pa.latest_release_id
            AND par.app_code = pa.app_code
          LIMIT 1),
         pa.latest_manifest_id
       )
      AND pam.app_code = pa.app_code
     INNER JOIN platform_app_manifest_resources mr
       ON mr.manifest_id = pam.id
      AND mr.app_code = pam.app_code
     LEFT JOIN platform_app_manifest_resource_actions mra
       ON mra.manifest_resource_id = mr.id
      AND mra.manifest_id = mr.manifest_id
      AND mra.app_code = mr.app_code
      AND mra.resource_code = mr.resource_code
      AND mra.status = 'active'
     WHERE pa.app_code = ?
       AND ${where.join(' AND ')}
     ORDER BY mr.sort_order ASC,
              mr.resource_code ASC,
              mra.sort_order ASC,
              mra.action ASC`,
    params
  )

  const resourceMap = new Map<number, {
    id: number
    manifestId: number
    manifestSeq: number
    appCode: string
    resourceCode: string
    resourceName: string
    description: string | null
    sortOrder: number
    actions: Array<{
      id: number
      action: string
      actionCode: string
      actionName: string | null
      description: string | null
      sortOrder: number
      requiresGrant: boolean
    }>
  }>()

  for (const row of rows) {
    if (!resourceMap.has(row.resource_id)) {
      resourceMap.set(row.resource_id, {
        id: row.resource_id,
        manifestId: row.manifest_id,
        manifestSeq: row.manifest_seq,
        appCode,
        resourceCode: row.resource_code,
        resourceName: row.resource_name,
        description: row.resource_description,
        sortOrder: row.resource_sort_order,
        actions: []
      })
    }

    if (row.action_id && row.action && row.action_code) {
      resourceMap.get(row.resource_id)?.actions.push({
        id: row.action_id,
        action: row.action,
        actionCode: row.action_code,
        actionName: row.action_name,
        description: row.action_description,
        sortOrder: row.action_sort_order || 0,
        requiresGrant: Boolean(row.requires_grant)
      })
    }
  }

  return ok({
    manifestId: rows[0]?.manifest_id ?? null,
    manifestSeq: rows[0]?.manifest_seq ?? null,
    items: Array.from(resourceMap.values())
  })
})
