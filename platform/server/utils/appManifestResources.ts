import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'

type TransactionExecutor = {
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
  execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
}

export interface ManifestResourceActionDefinition {
  action: string
  actionName: string | null
  description: string | null
  sortOrder: number
  requiresGrant: boolean
}

export interface ManifestResourceDefinition {
  resourceCode: string
  resourceName: string
  description: string | null
  sortOrder: number
  status: string
  actions: ManifestResourceActionDefinition[]
}

export interface ManifestActionRow extends RowDataPacket {
  id: number
  manifest_id: number
  app_code: string
  resource_code: string
  resource_name: string
  action: string
  action_code: string
  requires_grant: number
}

function placeholders(size: number) {
  return new Array(size).fill('?').join(', ')
}

function nullableString(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null
  }
  return String(value).trim() || null
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return value !== 0
  }
  const normalized = String(value).trim().toLowerCase()
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false
  }
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true
  }
  return undefined
}

function parseAction(value: unknown, index: number, resourceRequiresGrant: boolean | undefined): ManifestResourceActionDefinition | null {
  if (typeof value === 'string') {
    const action = value.trim()
    if (!action) {
      return null
    }
    return {
      action,
      actionName: null,
      description: null,
      sortOrder: (index + 1) * 10,
      requiresGrant: resourceRequiresGrant ?? true
    }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const action = nullableString(record.action) || nullableString(record.code)
  if (!action) {
    return null
  }

  return {
    action,
    actionName: nullableString(record.name),
    description: nullableString(record.description),
    sortOrder: Number(record.sortOrder ?? ((index + 1) * 10)) || ((index + 1) * 10),
    requiresGrant: optionalBoolean(record.requiresGrant) ?? resourceRequiresGrant ?? true
  }
}

export function parseManifestResources(manifestJson: Record<string, unknown>): ManifestResourceDefinition[] {
  const rawResources = Array.isArray(manifestJson.resources) ? manifestJson.resources : []
  const resources: ManifestResourceDefinition[] = []
  const seenResources = new Set<string>()

  for (const [resourceIndex, value] of rawResources.entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue
    }

    const record = value as Record<string, unknown>
    const resourceCode = nullableString(record.resourceCode) || nullableString(record.code)
    if (!resourceCode || seenResources.has(resourceCode)) {
      continue
    }
    seenResources.add(resourceCode)

    const resourceRequiresGrant = optionalBoolean(record.requiresGrant)
    const actionValues = Array.isArray(record.actions) ? record.actions : []
    const actions: ManifestResourceActionDefinition[] = []
    const seenActions = new Set<string>()

    for (const [actionIndex, actionValue] of actionValues.entries()) {
      const parsed = parseAction(actionValue, actionIndex, resourceRequiresGrant)
      if (!parsed || seenActions.has(parsed.action)) {
        continue
      }
      seenActions.add(parsed.action)
      actions.push(parsed)
    }

    resources.push({
      resourceCode,
      resourceName: nullableString(record.resourceName) || nullableString(record.name) || resourceCode,
      description: nullableString(record.description),
      sortOrder: Number(record.sortOrder ?? ((resourceIndex + 1) * 10)) || ((resourceIndex + 1) * 10),
      status: nullableString(record.status) || 'active',
      actions
    })
  }

  return resources
}

export async function syncManifestResourceActions(
  tx: TransactionExecutor,
  manifestId: number,
  appCode: string,
  manifestJson: Record<string, unknown>
) {
  const resources = parseManifestResources(manifestJson)
  const activeResourceCodes: string[] = []

  for (const resource of resources) {
    activeResourceCodes.push(resource.resourceCode)

    const insertedResource = await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_app_manifest_resources
        (manifest_id, app_code, resource_code, resource_name, description, sort_order, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id),
         resource_name = VALUES(resource_name),
         description = VALUES(description),
         sort_order = VALUES(sort_order),
         status = VALUES(status)`,
      [
        manifestId,
        appCode,
        resource.resourceCode,
        resource.resourceName,
        resource.description,
        resource.sortOrder,
        resource.status
      ]
    )

    const manifestResourceId = insertedResource.insertId
    const activeActions: string[] = []

    for (const action of resource.actions) {
      activeActions.push(action.action)
      await tx.execute<ResultSetHeader>(
        `INSERT INTO platform_app_manifest_resource_actions
          (manifest_resource_id, manifest_id, app_code, resource_code, action,
           action_name, description, sort_order, status, requires_grant, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NOW())
         ON DUPLICATE KEY UPDATE
           action_name = VALUES(action_name),
           description = VALUES(description),
           sort_order = VALUES(sort_order),
           status = 'active',
           requires_grant = VALUES(requires_grant)`,
        [
          manifestResourceId,
          manifestId,
          appCode,
          resource.resourceCode,
          action.action,
          action.actionName,
          action.description,
          action.sortOrder,
          action.requiresGrant ? 1 : 0
        ]
      )
    }

    if (activeActions.length) {
      await tx.execute<ResultSetHeader>(
        `UPDATE platform_app_manifest_resource_actions
         SET status = 'inactive'
         WHERE manifest_id = ?
           AND resource_code = ?
           AND action NOT IN (${placeholders(activeActions.length)})`,
        [manifestId, resource.resourceCode, ...activeActions]
      )
    } else {
      await tx.execute<ResultSetHeader>(
        `UPDATE platform_app_manifest_resource_actions
         SET status = 'inactive'
         WHERE manifest_id = ?
           AND resource_code = ?`,
        [manifestId, resource.resourceCode]
      )
    }
  }

  if (activeResourceCodes.length) {
    await tx.execute<ResultSetHeader>(
      `UPDATE platform_app_manifest_resources
       SET status = 'inactive'
       WHERE manifest_id = ?
         AND resource_code NOT IN (${placeholders(activeResourceCodes.length)})`,
      [manifestId, ...activeResourceCodes]
    )
    await tx.execute<ResultSetHeader>(
      `UPDATE platform_app_manifest_resource_actions
       SET status = 'inactive'
       WHERE manifest_id = ?
         AND resource_code NOT IN (${placeholders(activeResourceCodes.length)})`,
      [manifestId, ...activeResourceCodes]
    )
  } else {
    await tx.execute<ResultSetHeader>(
      `UPDATE platform_app_manifest_resources
       SET status = 'inactive'
       WHERE manifest_id = ?`,
      [manifestId]
    )
    await tx.execute<ResultSetHeader>(
      `UPDATE platform_app_manifest_resource_actions
       SET status = 'inactive'
       WHERE manifest_id = ?`,
      [manifestId]
    )
  }

  return resources
}

export async function loadManifestActions(
  tx: TransactionExecutor,
  manifestId: number,
  appCode: string
) {
  return tx.queryRows<ManifestActionRow[]>(
    `SELECT mra.id, mra.manifest_id, mra.app_code, mra.resource_code, mr.resource_name,
            mra.action, mra.action_code, mra.requires_grant
     FROM platform_app_manifest_resource_actions mra
     INNER JOIN platform_app_manifest_resources mr
       ON mr.id = mra.manifest_resource_id
      AND mr.manifest_id = mra.manifest_id
      AND mr.app_code = mra.app_code
      AND mr.resource_code = mra.resource_code
     WHERE mra.manifest_id = ?
       AND mra.app_code = ?
       AND mra.status = 'active'
       AND mr.status = 'active'
     ORDER BY mr.sort_order ASC, mra.sort_order ASC, mra.action ASC`,
    [manifestId, appCode]
  )
}
