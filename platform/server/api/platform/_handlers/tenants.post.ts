import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { queryRow, withTransaction } from '~~/server/utils/db'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'

interface TenantRow extends RowDataPacket {
  id: number
  tenant_code: string
  tenant_name: string
  display_name: string | null
  tenant_type: string
  primary_domain: string | null
  status: string
  default_auth_mode: string
  default_deployment_mode: string
  created_at: string
  updated_at: string
}

const ALLOWED_TENANT_TYPES = new Set(['enterprise', 'team', 'trial'])
const ALLOWED_STATUSES = new Set(['active', 'suspended', 'disabled'])
const ALLOWED_AUTH_MODES = new Set(['oidc', 'gitlab_oidc', 'cas', 'wecom'])
const ALLOWED_DEPLOYMENT_MODES = new Set(['managed-control-plane', 'self-hosted-enterprise'])

function requireAllowed(value: string, field: string, allowed: Set<string>) {
  if (!allowed.has(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${field} must be one of: ${Array.from(allowed).join(', ')}`
    })
  }

  return value
}

async function loadTenant(id: number) {
  return queryRow<TenantRow>(
    `SELECT id, tenant_code, tenant_name, display_name, tenant_type, primary_domain,
            status, default_auth_mode, default_deployment_mode, created_at, updated_at
     FROM tenants
     WHERE id = ?`,
    [id]
  )
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)

  const tenantName = requireString(body.tenantName, 'tenantName')
  const displayName = normalizeNullableString(body.displayName)
  const tenantType = requireAllowed(normalizeNullableString(body.tenantType) || 'enterprise', 'tenantType', ALLOWED_TENANT_TYPES)
  const primaryDomain = normalizeNullableString(body.primaryDomain)
  const status = requireAllowed(normalizeNullableString(body.status) || 'active', 'status', ALLOWED_STATUSES)
  const defaultAuthMode = requireAllowed(normalizeNullableString(body.defaultAuthMode) || 'oidc', 'defaultAuthMode', ALLOWED_AUTH_MODES)
  const defaultDeploymentMode = requireAllowed(
    normalizeNullableString(body.defaultDeploymentMode) || 'managed-control-plane',
    'defaultDeploymentMode',
    ALLOWED_DEPLOYMENT_MODES
  )

  const result = await withTransaction(async (tx) => {
    const latestTenant = await tx.queryRow<RowDataPacket>(
      `SELECT tenant_code
       FROM tenants
       WHERE tenant_code REGEXP '^C[0-9]{6}$'
       ORDER BY tenant_code DESC
       LIMIT 1
       FOR UPDATE`
    )

    const latestCode = typeof latestTenant?.tenant_code === 'string'
      ? latestTenant.tenant_code
      : null

    const nextSequence = latestCode
      ? Number.parseInt(latestCode.slice(1), 10) + 1
      : 1

    const tenantCode = `C${String(nextSequence).padStart(6, '0')}`

    const insertResult = await tx.execute<ResultSetHeader>(
      `INSERT INTO tenants
        (tenant_code, tenant_name, display_name, tenant_type, primary_domain, status, default_auth_mode, default_deployment_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        tenantCode,
        tenantName,
        displayName,
        tenantType,
        primaryDomain,
        status,
        defaultAuthMode,
        defaultDeploymentMode
      ]
    )

    return {
      insertId: insertResult.insertId,
      tenantCode
    }
  })

  const tenant = await loadTenant(result.insertId)
  if (!tenant) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load created tenant'
    })
  }

  return ok({
    id: tenant.id,
    tenantCode: tenant.tenant_code,
    tenantName: tenant.tenant_name,
    displayName: tenant.display_name,
    tenantType: tenant.tenant_type,
    primaryDomain: tenant.primary_domain,
    status: tenant.status,
    defaultAuthMode: tenant.default_auth_mode,
    defaultDeploymentMode: tenant.default_deployment_mode,
    createdAt: tenant.created_at,
    updatedAt: tenant.updated_at
  })
})
