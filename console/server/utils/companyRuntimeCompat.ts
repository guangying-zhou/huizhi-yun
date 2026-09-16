import {
  getConsoleTenantProfile,
  updateConsoleTenantProfile,
  type ConsoleTenantProfile,
  type ConsoleTenantProfileUpdate
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getHeader, type H3Event } from 'h3'

export interface LegacyCompanyInput {
  companyName?: string
  shortName?: string
  logo?: string
  industry?: string
  province?: string
  city?: string
  address?: string
  contactName?: string
  contactPhone?: string
  contactEmail?: string
  website?: string
  description?: string
  status?: number | string
}

function nullable(value: unknown) {
  const text = String(value || '').trim()
  return text || null
}

export function legacyCompanyFromProfile(profile: ConsoleTenantProfile) {
  return {
    id: null,
    companyCode: profile.tenantCode,
    companyName: profile.orgName,
    shortName: profile.orgShortName,
    logo: profile.logoPath,
    industry: profile.industryCode,
    scale: null,
    province: null,
    city: null,
    address: profile.addressText,
    contactName: profile.contactName,
    contactPhone: profile.contactMobile,
    contactEmail: profile.contactEmail,
    website: profile.websiteUrl,
    description: profile.displayName,
    status: profile.status === 'active' ? 1 : 0,
    createdAt: null,
    updatedAt: profile.updatedAt,
    revision: profile.revision
  }
}

export async function getLegacyRuntimeCompany(event: H3Event) {
  const response = await getConsoleTenantProfile(event)
  return legacyCompanyFromProfile(response.data)
}

export async function assertRuntimeCompanyCode(event: H3Event, companyCode: string) {
  const company = await getLegacyRuntimeCompany(event)
  if (company.companyCode !== companyCode) {
    throw createError({ statusCode: 404, message: '公司不存在' })
  }
  return company
}

export async function listLegacyRuntimeCompanies(event: H3Event, query: Record<string, unknown>) {
  const company = await getLegacyRuntimeCompany(event)
  const search = String(query.search || '').trim().toLowerCase()
  const status = String(query.status ?? '').trim()
  if (search && ![
    company.companyCode,
    company.companyName,
    company.shortName
  ].some(value => String(value || '').toLowerCase().includes(search))) {
    return []
  }
  if (status && Number(status) !== company.status) {
    return []
  }
  return [company]
}

export async function updateLegacyRuntimeCompany(
  event: H3Event,
  companyCode: string,
  input: LegacyCompanyInput
) {
  const currentResponse = await getConsoleTenantProfile(event)
  const current = currentResponse.data
  if (current.tenantCode !== companyCode) {
    throw createError({ statusCode: 404, message: '公司不存在' })
  }
  if (!String(getHeader(event, 'idempotency-key') || '').trim()) {
    throw createError({ statusCode: 400, message: '更新企业资料必须提供 Idempotency-Key。' })
  }
  if (input.status !== undefined) {
    const requestedActive = input.status === 1 || input.status === '1' || input.status === 'active'
    if (requestedActive !== (current.status === 'active')) {
      throw createError({ statusCode: 400, message: '企业状态不允许通过兼容 API 修改。' })
    }
  }
  const addressFromRegion = [input.province, input.city].map(nullable).filter(Boolean).join(' ')
  const update: ConsoleTenantProfileUpdate = {
    expectedRevision: current.revision,
    orgName: input.companyName === undefined ? current.orgName : String(input.companyName || '').trim(),
    orgShortName: input.shortName === undefined ? current.orgShortName : nullable(input.shortName),
    displayName: input.description === undefined ? current.displayName : nullable(input.description),
    legalName: current.legalName,
    unifiedSocialCreditCode: current.unifiedSocialCreditCode,
    logoPath: input.logo === undefined ? current.logoPath : nullable(input.logo),
    websiteUrl: input.website === undefined ? current.websiteUrl : nullable(input.website),
    industryCode: input.industry === undefined ? current.industryCode : nullable(input.industry),
    countryCode: current.countryCode,
    timezone: current.timezone,
    locale: current.locale,
    currencyCode: current.currencyCode,
    contactName: input.contactName === undefined ? current.contactName : nullable(input.contactName),
    contactEmail: input.contactEmail === undefined ? current.contactEmail : nullable(input.contactEmail),
    contactMobile: input.contactPhone === undefined ? current.contactMobile : nullable(input.contactPhone),
    addressText: input.address === undefined && !addressFromRegion
      ? current.addressText
      : nullable(input.address) || nullable(addressFromRegion)
  }
  return await updateConsoleTenantProfile(event, update)
}
