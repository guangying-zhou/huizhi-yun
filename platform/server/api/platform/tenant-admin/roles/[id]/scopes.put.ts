import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow, withTransaction } from '~~/server/utils/db'
import { refreshTenantRolePolicySnapshot } from '~~/server/utils/rolePolicyHash'
import { TENANT_CONSOLE_APP_CODE } from '~~/server/utils/tenantConsole'

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

const ALLOWED_SCOPE_STATUSES = new Set(['active', 'disabled'])

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
  const scopes = Array.isArray(body.scopes) ? body.scopes : null

  if (!scopes) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'scopes must be an array'
    })
  }

  const role = await queryRow<RoleRow>(
    `SELECT id, tenant_code, app_code, source
     FROM tenant_roles
     WHERE id = ?
     LIMIT 1`,
    [id]
  )

  if (!role || role.app_code !== TENANT_CONSOLE_APP_CODE) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant console role not found: id=${id}`
    })
  }

  const prepared = scopes.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `scopes[${index}] is invalid`
      })
    }

    const record = item as Record<string, unknown>
    const resourceCode = String(record.resourceCode || '').trim()
    const action = requireAction(record.action)
    const scopeType = String(record.scopeType || '').trim()
    const scopeValue = String(record.scopeValue || '').trim()
    const status = String(record.status || 'active').trim()

    if (!resourceCode) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `scopes[${index}].resourceCode is required`
      })
    }

    if (!scopeType) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `scopes[${index}].scopeType is required`
      })
    }

    if (!scopeValue) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `scopes[${index}].scopeValue is required`
      })
    }

    if (!ALLOWED_SCOPE_STATUSES.has(status)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `scopes[${index}].status must be one of: ${Array.from(ALLOWED_SCOPE_STATUSES).join(', ')}`
      })
    }

    return {
      resourceCode,
      appCode: TENANT_CONSOLE_APP_CODE,
      action,
      scopeType,
      scopeValue,
      status
    }
  })

  const uniqueKeys = new Set<string>()
  for (const scope of prepared) {
    const key = `${scope.appCode}::${scope.resourceCode}::${scope.action}::${scope.scopeType}::${scope.scopeValue}`
    if (uniqueKeys.has(key)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `duplicate scope entry: ${key}`
      })
    }
    uniqueKeys.add(key)
  }

  const applied = await withTransaction(async (tx) => {
    const resolved: Array<{
      appCode: string
      resourceCode: string
      action: string
      sourceManifestActionId: number
      scopeType: string
      scopeValue: string
      status: string
    }> = []

    for (const scope of prepared) {
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
        [TENANT_CONSOLE_APP_CODE, scope.resourceCode, scope.action]
      )

      if (!manifestAction) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Not Found',
          message: `manifest action not found: appCode=${TENANT_CONSOLE_APP_CODE}, resourceCode=${scope.resourceCode}, action=${scope.action}`
        })
      }

      resolved.push({
        appCode: manifestAction.app_code,
        resourceCode: manifestAction.resource_code,
        action: manifestAction.action,
        sourceManifestActionId: manifestAction.id,
        scopeType: scope.scopeType,
        scopeValue: scope.scopeValue,
        status: scope.status
      })
    }

    await tx.execute<ResultSetHeader>(
      `DELETE FROM tenant_role_scopes
       WHERE tenant_code = ?
         AND role_id = ?
         AND app_code = ?`,
      [role.tenant_code, id, TENANT_CONSOLE_APP_CODE]
    )

    for (const scope of resolved) {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO tenant_role_scopes
          (tenant_code, role_id, app_code, resource_code, action, source_manifest_action_id, scope_type, scope_value, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [role.tenant_code, id, scope.appCode, scope.resourceCode, scope.action, scope.sourceManifestActionId, scope.scopeType, scope.scopeValue, scope.status]
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
    scopes: applied,
    total: applied.length
  })
})
