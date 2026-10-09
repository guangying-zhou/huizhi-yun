import type { RowDataPacket } from 'mysql2/promise'
import { contractOk } from '~~/server/utils/controlPlaneV1'
import { normalizeNullableString, requireString } from '~~/server/utils/api'
import { parseStoredJson } from '~~/server/utils/platform'
import { queryRow } from '~~/server/utils/db'

interface TenantProfileRow extends RowDataPacket {
  tenant_code: string
  tenant_name: string
  display_name: string | null
  tenant_type: string
  primary_domain: string | null
  status: string
  owner_contact_email: string | null
  settings_json: unknown
  created_at: string
  updated_at: string
}

function normalizeSettings(value: unknown) {
  const parsed = parseStoredJson<Record<string, unknown>>(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
}

function pickString(settings: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = normalizeNullableString(settings[key])
    if (value) {
      return value
    }
  }

  return null
}

function normalizeWebsite(primaryDomain: string | null, settings: Record<string, unknown>) {
  const configured = pickString(settings, 'websiteUrl', 'website_url', 'website')
  if (configured) {
    return configured
  }

  if (!primaryDomain) {
    return null
  }

  return primaryDomain.startsWith('http://') || primaryDomain.startsWith('https://')
    ? primaryDomain
    : `https://${primaryDomain}`
}

export default defineEventHandler(async (event) => {
  const routeTenantCode = requireString(getRouterParam(event, 'tenantCode'), 'tenantCode')
  const runtimeTenantCode = String(event.context.platformTenantCode || '').trim()

  if (runtimeTenantCode && runtimeTenantCode !== routeTenantCode) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `runtime tenant context mismatch: ${runtimeTenantCode} !== ${routeTenantCode}`
    })
  }

  const tenant = await queryRow<TenantProfileRow>(
    `SELECT tenant_code, tenant_name, display_name, tenant_type, primary_domain,
            status, owner_contact_email, settings_json, created_at, updated_at
     FROM tenants
     WHERE tenant_code = ?
     LIMIT 1`,
    [routeTenantCode]
  )

  if (!tenant) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant not found: tenantCode=${routeTenantCode}`
    })
  }

  const settings = normalizeSettings(tenant.settings_json)

  return contractOk({
    tenantCode: tenant.tenant_code,
    tenantName: tenant.tenant_name,
    displayName: tenant.display_name || tenant.tenant_name,
    tenantType: tenant.tenant_type,
    primaryDomain: tenant.primary_domain,
    status: tenant.status,
    orgProfile: {
      orgName: pickString(settings, 'orgName', 'org_name', 'legalName', 'legal_name') || tenant.tenant_name,
      orgShortName: pickString(settings, 'orgShortName', 'org_short_name', 'shortName', 'short_name') || tenant.display_name,
      displayName: pickString(settings, 'displayName', 'display_name') || tenant.display_name || tenant.tenant_name,
      legalName: pickString(settings, 'legalName', 'legal_name'),
      unifiedSocialCreditCode: pickString(settings, 'unifiedSocialCreditCode', 'unified_social_credit_code'),
      logoPath: pickString(settings, 'logoPath', 'logo_path', 'logo'),
      websiteUrl: normalizeWebsite(tenant.primary_domain, settings),
      industryCode: pickString(settings, 'industryCode', 'industry_code', 'industry'),
      countryCode: pickString(settings, 'countryCode', 'country_code') || 'CN',
      timezone: pickString(settings, 'timezone') || 'Asia/Shanghai',
      locale: pickString(settings, 'locale', 'language') || 'zh-CN',
      currencyCode: pickString(settings, 'currencyCode', 'currency_code') || 'CNY',
      contactName: pickString(settings, 'contactName', 'contact_name'),
      contactEmail: pickString(settings, 'contactEmail', 'contact_email') || tenant.owner_contact_email,
      contactMobile: pickString(settings, 'contactMobile', 'contact_mobile'),
      addressText: pickString(settings, 'addressText', 'address_text', 'address')
    },
    updatedAt: tenant.updated_at,
    createdAt: tenant.created_at
  })
})
