import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow, withTransaction } from '~~/server/utils/db'
import { refreshTenantRolePolicySnapshot } from '~~/server/utils/rolePolicyHash'

interface RoleRow extends RowDataPacket {
  id: number
  tenant_code: string
  app_code: string | null
  source: string
}

interface ManifestActionRow extends RowDataPacket {
  id: number
  app_code: string
  resource_code: string
  action: string
}

function requireId(event: H3Event) {
  const raw = getRouterParam(event, 'id')
  const id = Number(raw)
  if (!raw || Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'id is invalid'
    })
  }

  return id
}

function requireAction(action: unknown) {
  const normalized = String(action || '').trim()
  if (!normalized) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'action is required'
    })
  }

  return normalized
}

export default defineEventHandler(async (event) => {
  const id = requireId(event)
  const body = await readBody<Record<string, unknown>>(event)
  const permissions = Array.isArray(body.permissions) ? body.permissions : null

  if (!permissions) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'permissions must be an array'
    })
  }

  const role = await queryRow<RoleRow>(
    `SELECT id, tenant_code, app_code, source
     FROM tenant_roles
     WHERE id = ?
     LIMIT 1`,
    [id]
  )

  if (!role) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant role not found: id=${id}`
    })
  }

  const prepared = permissions.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `permissions[${index}] is invalid`
      })
    }

    const record = item as Record<string, unknown>
    const resourceCode = String(record.resourceCode || '').trim()
    const appCode = String(record.appCode || role.app_code || '').trim()
    const action = requireAction(record.action)

    if (!resourceCode) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `permissions[${index}].resourceCode is required`
      })
    }

    if (!appCode) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `permissions[${index}].appCode is required when role.appCode is empty`
      })
    }

    return { resourceCode, appCode, action }
  })

  const uniqueKeys = new Set<string>()
  for (const permission of prepared) {
    const key = `${permission.appCode}::${permission.resourceCode}::${permission.action}`
    if (uniqueKeys.has(key)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `duplicate permission entry: ${key}`
      })
    }
    uniqueKeys.add(key)
  }

  const applied = await withTransaction(async (tx) => {
    const resolved: Array<{ appCode: string, resourceCode: string, action: string, sourceManifestActionId: number }> = []

    for (const permission of prepared) {
      const manifestAction = await tx.queryRow<ManifestActionRow>(
        `SELECT mra.id, mra.app_code, mra.resource_code, mra.action
         FROM platform_applications pa
         INNER JOIN platform_app_manifest_resource_actions mra
           ON mra.app_code = pa.app_code
          AND mra.manifest_id = pa.latest_manifest_id
         INNER JOIN platform_app_manifest_resources mr
           ON mr.id = mra.manifest_resource_id
          AND mr.manifest_id = mra.manifest_id
          AND mr.app_code = mra.app_code
          AND mr.resource_code = mra.resource_code
         WHERE pa.app_code = ?
           AND mra.resource_code = ?
           AND mra.action = ?
           AND mra.status = 'active'
           AND mr.status = 'active'
         LIMIT 1`,
        [permission.appCode, permission.resourceCode, permission.action]
      )

      if (!manifestAction) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Not Found',
          message: `manifest action not found: appCode=${permission.appCode}, resourceCode=${permission.resourceCode}, action=${permission.action}`
        })
      }

      resolved.push({
        appCode: manifestAction.app_code,
        resourceCode: manifestAction.resource_code,
        action: manifestAction.action,
        sourceManifestActionId: manifestAction.id
      })
    }

    await tx.execute<ResultSetHeader>(
      `DELETE FROM tenant_role_permissions
       WHERE tenant_code = ?
         AND role_id = ?`,
      [role.tenant_code, id]
    )

    for (const permission of resolved) {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO tenant_role_permissions
          (tenant_code, role_id, app_code, resource_code, action, source_manifest_action_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [role.tenant_code, id, permission.appCode, permission.resourceCode, permission.action, permission.sourceManifestActionId]
      )
    }

    await refreshTenantRolePolicySnapshot(tx, role.tenant_code, id, {
      isOverridden: role.source === 'system' ? true : undefined
    })

    return resolved
  })

  return ok({
    roleId: id,
    tenantCode: role.tenant_code,
    permissions: applied,
    total: applied.length
  })
})
