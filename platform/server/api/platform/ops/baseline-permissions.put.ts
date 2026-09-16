import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'
import { isMissingBaselineGovernanceTableError } from '~~/server/utils/policyBundleBaseline'

interface ManifestActionRow extends RowDataPacket {
  id: number
}

const SCOPE_TYPES = new Set(['tenant', 'subject', 'relation', 'department', 'project', 'customer', 'object'])

function normalizePermission(item: unknown, index: number) {
  const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
  const appCode = requireString(record.appCode, `permissions[${index}].appCode`).trim()
  const resourceCode = requireString(record.resourceCode, `permissions[${index}].resourceCode`).trim()
  const action = requireString(record.action, `permissions[${index}].action`).trim()
  const scopeType = requireString(record.scopeType, `permissions[${index}].scopeType`).trim()
  const scopeValue = requireString(record.scopeValue, `permissions[${index}].scopeValue`).trim()
  const description = normalizeNullableString(record.description)

  if (!SCOPE_TYPES.has(scopeType)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `permissions[${index}].scopeType must be one of: ${Array.from(SCOPE_TYPES).join(', ')}`
    })
  }

  return { appCode, resourceCode, action, scopeType, scopeValue, description }
}

function normalizeExcludedSubject(item: unknown, index: number) {
  const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
  const subjectCode = requireString(record.subjectCode, `excludedSubjects[${index}].subjectCode`).trim()
  return {
    subjectCode,
    displayName: normalizeNullableString(record.displayName),
    reason: normalizeNullableString(record.reason)
  }
}

function permissionKey(permission: ReturnType<typeof normalizePermission>) {
  return [
    permission.appCode,
    permission.resourceCode,
    permission.action,
    permission.scopeType,
    permission.scopeValue
  ].join(':')
}

function schemaMissingError() {
  return createError({
    statusCode: 503,
    statusMessage: 'Service Unavailable',
    message: 'Platform database schema is missing default login baseline permission tables. Run platform/docs/sql/HZY-Platform-SQL-Migration-v2.25-default-login-baseline-permissions.sql, then retry.'
  })
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown> | null>(event).catch(() => null)
  const permissions = (body && Array.isArray(body.permissions) ? body.permissions : [])
    .map(normalizePermission)
  const excludedSubjects = (body && Array.isArray(body.excludedSubjects) ? body.excludedSubjects : [])
    .map(normalizeExcludedSubject)

  const permissionKeys = permissions.map(permissionKey)
  if (new Set(permissionKeys).size !== permissionKeys.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: 'duplicate baseline permissions'
    })
  }

  const subjectCodes = excludedSubjects.map(item => item.subjectCode)
  if (new Set(subjectCodes).size !== subjectCodes.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: 'duplicate excluded subjects'
    })
  }

  try {
    await withTransaction(async (tx) => {
      await tx.execute<ResultSetHeader>('DELETE FROM platform_baseline_permissions')
      await tx.execute<ResultSetHeader>('DELETE FROM platform_baseline_excluded_subjects')

      for (const [index, permission] of permissions.entries()) {
        const manifestAction = await tx.queryRow<ManifestActionRow>(
          `SELECT id
           FROM platform_app_manifest_resource_actions
           WHERE app_code = ?
             AND resource_code = ?
             AND action = ?
             AND status = 'active'
           ORDER BY manifest_id DESC, id DESC
           LIMIT 1`,
          [permission.appCode, permission.resourceCode, permission.action]
        )
        if (!manifestAction) {
          throw createError({
            statusCode: 400,
            statusMessage: 'Bad Request',
            message: `permissions[${index}] must reference an active manifest action: ${permission.appCode}:${permission.resourceCode}:${permission.action}`
          })
        }

        await tx.execute<ResultSetHeader>(
          `INSERT INTO platform_baseline_permissions
            (app_code, resource_code, action, scope_type, scope_value, source_manifest_action_id,
             description, sort_order, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
          [
            permission.appCode,
            permission.resourceCode,
            permission.action,
            permission.scopeType,
            permission.scopeValue,
            manifestAction.id,
            permission.description,
            index
          ]
        )
      }

      for (const subject of excludedSubjects) {
        await tx.execute<ResultSetHeader>(
          `INSERT INTO platform_baseline_excluded_subjects
            (subject_code, display_name, reason, status, created_at, updated_at)
           VALUES (?, ?, ?, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
          [subject.subjectCode, subject.displayName, subject.reason]
        )
      }
    })
  } catch (error) {
    if (isMissingBaselineGovernanceTableError(error)) {
      throw schemaMissingError()
    }
    throw error
  }

  return ok({
    permissions,
    excludedSubjects
  })
})
