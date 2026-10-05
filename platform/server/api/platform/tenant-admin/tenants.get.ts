import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow } from '~~/server/utils/db'
import { getTenantContextCode } from '~~/server/utils/access'

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

export default defineEventHandler(async (event) => {
  const contextTenantCode = String(event.context.platformTenantCode || '').trim()
  const fallbackTenantCode = getTenantContextCode(event).effectiveTenantCode
  const tenantCode = contextTenantCode || fallbackTenantCode

  if (!tenantCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenant context is missing'
    })
  }

  const tenant = await queryRow<TenantRow>(
    `SELECT id, tenant_code, tenant_name, display_name, tenant_type, primary_domain,
            status, default_auth_mode, default_deployment_mode, created_at, updated_at
     FROM tenants
     WHERE tenant_code = ?
     LIMIT 1`,
    [tenantCode]
  )

  if (!tenant) {
    return ok({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20
    })
  }

  return ok({
    items: [
      {
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
      }
    ],
    total: 1,
    page: 1,
    pageSize: 20
  })
})
