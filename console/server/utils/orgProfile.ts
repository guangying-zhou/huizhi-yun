import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow } from '~~/server/utils/db'

export interface PlatformTenantOrgProfile {
  orgName: string
  orgShortName?: string | null
  displayName?: string | null
  legalName?: string | null
  unifiedSocialCreditCode?: string | null
  logoPath?: string | null
  websiteUrl?: string | null
  industryCode?: string | null
  countryCode?: string | null
  timezone?: string | null
  locale?: string | null
  currencyCode?: string | null
  contactName?: string | null
  contactEmail?: string | null
  contactMobile?: string | null
  addressText?: string | null
}

export interface PlatformTenantProfile {
  tenantCode: string
  tenantName: string
  displayName?: string | null
  tenantType?: string | null
  primaryDomain?: string | null
  status: string
  orgProfile?: PlatformTenantOrgProfile | null
}

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function normalizeNullableString(value: unknown) {
  const normalized = normalizeString(value)
  return normalized || null
}

function normalizeOrgStatus(platformStatus: string) {
  return platformStatus === 'active' ? 'active' : 'inactive'
}

export async function upsertOrgProfileFromPlatformTenant(profile: PlatformTenantProfile) {
  const orgProfile = profile.orgProfile || null
  const tenantCode = normalizeString(profile.tenantCode)
  const orgName = normalizeNullableString(orgProfile?.orgName) || normalizeNullableString(profile.tenantName) || tenantCode

  if (!tenantCode) {
    throw new Error('platform tenant profile missing tenantCode')
  }

  await execute<ResultSetHeader>(
    `INSERT INTO org_profiles
      (singleton_key, tenant_code, org_name, org_short_name, display_name, legal_name,
       unified_social_credit_code, logo_path, website_url, industry_code, country_code,
       timezone, locale, currency_code, contact_name, contact_email, contact_mobile,
       address_text, status, created_at, updated_at)
     VALUES
      (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       tenant_code = VALUES(tenant_code),
       org_name = VALUES(org_name),
       org_short_name = VALUES(org_short_name),
       display_name = VALUES(display_name),
       legal_name = VALUES(legal_name),
       unified_social_credit_code = VALUES(unified_social_credit_code),
       logo_path = VALUES(logo_path),
       website_url = VALUES(website_url),
       industry_code = VALUES(industry_code),
       country_code = VALUES(country_code),
       timezone = VALUES(timezone),
       locale = VALUES(locale),
       currency_code = VALUES(currency_code),
       contact_name = VALUES(contact_name),
       contact_email = VALUES(contact_email),
       contact_mobile = VALUES(contact_mobile),
       address_text = VALUES(address_text),
       status = VALUES(status),
       updated_at = NOW()`,
    [
      tenantCode,
      orgName,
      normalizeNullableString(orgProfile?.orgShortName),
      normalizeNullableString(orgProfile?.displayName) || normalizeNullableString(profile.displayName) || orgName,
      normalizeNullableString(orgProfile?.legalName),
      normalizeNullableString(orgProfile?.unifiedSocialCreditCode),
      normalizeNullableString(orgProfile?.logoPath),
      normalizeNullableString(orgProfile?.websiteUrl) || normalizeNullableString(profile.primaryDomain),
      normalizeNullableString(orgProfile?.industryCode),
      normalizeNullableString(orgProfile?.countryCode) || 'CN',
      normalizeNullableString(orgProfile?.timezone) || 'Asia/Shanghai',
      normalizeNullableString(orgProfile?.locale) || 'zh-CN',
      normalizeNullableString(orgProfile?.currencyCode) || 'CNY',
      normalizeNullableString(orgProfile?.contactName),
      normalizeNullableString(orgProfile?.contactEmail),
      normalizeNullableString(orgProfile?.contactMobile),
      normalizeNullableString(orgProfile?.addressText),
      normalizeOrgStatus(normalizeString(profile.status))
    ]
  )
}

export async function hasOrgProfile() {
  const row = await queryRow<RowDataPacket & { id: number }>(
    'SELECT id FROM org_profiles WHERE singleton_key = 1 LIMIT 1'
  )

  return Boolean(row)
}
