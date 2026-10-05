import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from '~~/server/utils/db'
import { normalizeNullableString, ok } from '~~/server/utils/api'

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
  const id = requireId(event)
  const body = await readBody<Record<string, unknown>>(event)

  const updates: string[] = []
  const params: Array<string | number | null> = []

  if (body.tenantName !== undefined) {
    updates.push('tenant_name = ?')
    params.push(String(body.tenantName || '').trim())
  }

  if (body.displayName !== undefined) {
    updates.push('display_name = ?')
    params.push(normalizeNullableString(body.displayName))
  }

  if (body.tenantType !== undefined) {
    updates.push('tenant_type = ?')
    params.push(requireAllowed(String(body.tenantType), 'tenantType', ALLOWED_TENANT_TYPES))
  }

  if (body.primaryDomain !== undefined) {
    updates.push('primary_domain = ?')
    params.push(normalizeNullableString(body.primaryDomain))
  }

  if (body.status !== undefined) {
    updates.push('status = ?')
    params.push(requireAllowed(String(body.status), 'status', ALLOWED_STATUSES))
  }

  if (body.defaultAuthMode !== undefined) {
    updates.push('default_auth_mode = ?')
    params.push(requireAllowed(String(body.defaultAuthMode), 'defaultAuthMode', ALLOWED_AUTH_MODES))
  }

  if (body.defaultDeploymentMode !== undefined) {
    updates.push('default_deployment_mode = ?')
    params.push(requireAllowed(String(body.defaultDeploymentMode), 'defaultDeploymentMode', ALLOWED_DEPLOYMENT_MODES))
  }

  if (updates.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'no updatable fields provided'
    })
  }

  const existing = await loadTenant(id)
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant not found: id=${id}`
    })
  }

  if (updates.includes('tenant_name = ?') && !params[updates.indexOf('tenant_name = ?')]) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenantName is required'
    })
  }

  await execute<ResultSetHeader>(
    `UPDATE tenants
     SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = ?`,
    [...params, id]
  )

  const tenant = await loadTenant(id)
  if (!tenant) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'failed to load updated tenant'
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
