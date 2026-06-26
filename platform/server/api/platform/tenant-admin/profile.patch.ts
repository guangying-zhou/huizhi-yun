import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'
import { normalizePublicUrl } from '~~/server/utils/appUrls'
import { ensureDeploymentSite, findActiveDeploymentSite } from '~~/server/utils/deploymentSites'

interface TenantRow extends RowDataPacket {
  id: number
  tenant_code: string
  tenant_name: string
  display_name: string | null
  tenant_type: string
  primary_domain: string | null
  status: string
  default_deployment_mode: string
  settings_json: string | null
}

const ALLOWED_INDUSTRY_CATEGORIES = new Set('ABCDEFGHIJKLMNOPQRST'.split(''))
const ALLOWED_COMPANY_SIZES = new Set(['micro', 'small', 'medium', 'large'])

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function optionalAllowed(value: unknown, field: string, allowed: Set<string>) {
  const normalized = normalizeString(value)
  if (!normalized) return null
  if (!allowed.has(normalized)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${field} must be one of: ${Array.from(allowed).join(', ')}`
    })
  }

  return normalized
}

function parseSettings(value: string | null) {
  if (!value) {
    return {}
  }

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

export default defineEventHandler(async (event) => {
  const tenantCode = String(event.context.platformTenantCode || '').trim()
  const membership = event.context.platformTenantMembership
  const accountId = Number(event.context.platformAccountId || 0) || null

  if (!tenantCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenant context is missing'
    })
  }

  if (!membership?.isOwner) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'only tenant owner can update enterprise profile'
    })
  }

  const body = await readBody<Record<string, unknown>>(event)
  const tenantName = normalizeString(body.tenantName)
  if (!tenantName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenantName is required'
    })
  }

  const deploymentPublicUrlProvided = body.deploymentPublicUrl !== undefined
  const deploymentPublicUrl = deploymentPublicUrlProvided
    ? normalizePublicUrl(body.deploymentPublicUrl)
    : null
  if (deploymentPublicUrlProvided && !deploymentPublicUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'deploymentPublicUrl must be an absolute http(s) URL'
    })
  }

  const saved = await withTransaction(async (tx) => {
    const existing = await tx.queryRow<TenantRow>(
      `SELECT id, tenant_code, tenant_name, display_name, tenant_type, primary_domain,
              status, default_deployment_mode, settings_json
       FROM tenants
       WHERE tenant_code = ?
       LIMIT 1
       FOR UPDATE`,
      [tenantCode]
    )

    if (!existing) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `tenant not found: tenantCode=${tenantCode}`
      })
    }

    const settings = {
      ...parseSettings(existing.settings_json),
      industryCategory: optionalAllowed(body.industryCategory, 'industryCategory', ALLOWED_INDUSTRY_CATEGORIES),
      companySize: optionalAllowed(body.companySize, 'companySize', ALLOWED_COMPANY_SIZES),
      province: normalizeNullableString(body.province),
      city: normalizeNullableString(body.city)
    }

    await tx.execute<ResultSetHeader>(
      `UPDATE tenants
       SET tenant_name = ?,
           display_name = ?,
           primary_domain = ?,
           settings_json = ?,
           updated_at = UTC_TIMESTAMP()
       WHERE tenant_code = ?`,
      [
        tenantName,
        normalizeNullableString(body.displayName),
        normalizeNullableString(body.primaryDomain),
        JSON.stringify(settings),
        tenantCode
      ]
    )

    const existingSite = deploymentPublicUrlProvided
      ? await findActiveDeploymentSite(tenantCode, tx)
      : null
    const site = deploymentPublicUrlProvided
      ? await ensureDeploymentSite({
          executor: tx,
          tenantCode,
          tenantName,
          publicUrl: deploymentPublicUrl!,
          rootAppCode: existingSite?.root_app_code || null,
          createdByAccountId: accountId
        })
      : null

    return {
      tenantCode,
      tenantName,
      displayName: normalizeNullableString(body.displayName),
      primaryDomain: normalizeNullableString(body.primaryDomain),
      industryCategory: settings.industryCategory || null,
      companySize: settings.companySize || null,
      province: settings.province || null,
      city: settings.city || null,
      deploymentPublicUrl: site?.public_url || deploymentPublicUrl || null,
      deploymentRootAppCode: site?.root_app_code || null
    }
  })

  return ok(saved)
})
