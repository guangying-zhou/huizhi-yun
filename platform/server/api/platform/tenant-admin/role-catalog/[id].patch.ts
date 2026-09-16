import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { queryRow, withTransaction } from '~~/server/utils/db'
import {
  deriveRoleCatalogCategory,
  isRoleCatalogMetadataMissingTableError,
  normalizeRoleCatalogCategory,
  ROLE_CATALOG_CATEGORIES
} from '~~/server/utils/roleCatalogCategory'

interface RoleRow extends RowDataPacket {
  id: number
  tenant_code: string
  role_code: string
  role_name: string
  role_type: string
  app_code: string | null
  description: string | null
  source: string
  source_role_code: string | null
  status: string
  is_assignable: number
}

interface MetadataRow extends RowDataPacket {
  category: string
  governance_note: string | null
  split_suggestion: string | null
  updated_by_uid: string | null
  updated_at: string
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

function limitText(value: string | null, field: string, maxLength: number) {
  if (value && value.length > maxLength) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${field} must be at most ${maxLength} characters`
    })
  }

  return value
}

async function loadRole(tenantCode: string, id: number) {
  return await queryRow<RoleRow>(
    `SELECT id, tenant_code, role_code, role_name, role_type, app_code,
            description, source, source_role_code, status, is_assignable
     FROM tenant_roles
     WHERE tenant_code = ?
       AND id = ?
       AND app_code IS NULL
       AND is_assignable = 1
     LIMIT 1`,
    [tenantCode, id]
  )
}

async function loadMetadata(tenantCode: string, roleId: number) {
  return await queryRow<MetadataRow>(
    `SELECT category, governance_note, split_suggestion, updated_by_uid, updated_at
     FROM tenant_role_catalog_metadata
     WHERE tenant_code = ?
       AND role_id = ?
     LIMIT 1`,
    [tenantCode, roleId]
  )
}

export default defineEventHandler(async (event) => {
  const id = requireId(event)
  const body = await readBody<Record<string, unknown>>(event)
  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const category = normalizeRoleCatalogCategory(body.category)
  if (!category) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `category must be one of: ${ROLE_CATALOG_CATEGORIES.map(item => item.value).join(', ')}`
    })
  }

  const governanceNote = limitText(normalizeNullableString(body.governanceNote)?.trim() || null, 'governanceNote', 1000)
  const splitSuggestion = limitText(normalizeNullableString(body.splitSuggestion)?.trim() || null, 'splitSuggestion', 1000)
  const role = await loadRole(tenantCode, id)
  if (!role) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `assignable tenant role not found: id=${id}`
    })
  }

  const updatedByUid = String(event.context.platformUid || '').trim() || null
  try {
    await withTransaction(async (tx) => {
      await tx.execute<ResultSetHeader>(
        `INSERT INTO tenant_role_catalog_metadata
          (tenant_code, role_id, category, governance_note, split_suggestion,
           updated_by_uid, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE
           category = VALUES(category),
           governance_note = VALUES(governance_note),
           split_suggestion = VALUES(split_suggestion),
           updated_by_uid = VALUES(updated_by_uid),
           updated_at = UTC_TIMESTAMP()`,
        [tenantCode, id, category, governanceNote, splitSuggestion, updatedByUid]
      )
    })
  } catch (error) {
    if (!isRoleCatalogMetadataMissingTableError(error)) throw error

    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: 'tenant_role_catalog_metadata migration has not been applied'
    })
  }

  const metadata = await loadMetadata(tenantCode, id)
  const derivedCategory = deriveRoleCatalogCategory({
    roleCode: role.role_code,
    roleName: role.role_name,
    description: role.description,
    source: role.source,
    catalogCategory: metadata?.category || category
  })

  return ok({
    id: role.id,
    tenantCode: role.tenant_code,
    roleCode: role.role_code,
    roleName: role.role_name,
    roleType: role.role_type,
    source: role.source,
    sourceRoleCode: role.source_role_code,
    status: role.status,
    isAssignable: Boolean(role.is_assignable),
    category: derivedCategory.category,
    categoryLabel: derivedCategory.label,
    categorySource: derivedCategory.source,
    governanceNote: metadata?.governance_note || null,
    splitSuggestion: metadata?.split_suggestion || null,
    catalogUpdatedByUid: metadata?.updated_by_uid || null,
    catalogUpdatedAt: metadata?.updated_at || null
  })
})
