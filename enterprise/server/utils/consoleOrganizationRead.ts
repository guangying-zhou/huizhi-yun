import { createError, getQuery, getRouterParam, type H3Event } from 'h3'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'
import type { ConsoleOrganizationRead, ConsoleRegionDivision } from '@hzy/foundation/app/types/consoleOrganization'

const invalid = () => createError({ statusCode: 502, message: 'Organization response invalid' })
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function text(value: unknown, max = 512) {
  if (typeof value !== 'string' || value.length > max) throw invalid()
  return value
}
function code(value: unknown) {
  const result = text(value, 128)
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(result) || ['.', '..'].includes(result)) throw invalid()
  return result
}
const nullableText = (value: unknown) => value == null ? null : text(value, 2048)
function number(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw invalid()
  return value
}
function list(value: unknown) {
  if (!Array.isArray(value)) throw invalid()
  return value.map(record)
}
export function organizationQuery(event: H3Event) {
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: 'Unsupported organization query' })
}
export function organizationRegionCode(event: H3Event) {
  const value = getRouterParam(event, 'regionCode') || ''
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(value) || ['.', '..'].includes(value)) throw createError({ statusCode: 400, message: 'Invalid region code' })
  return value
}
export async function fetchOrganizationRead(event: H3Event, id: string, params?: Record<string, string>) {
  try {
    return await fetchConsoleUserApi<unknown>(event, id, { params })
  } catch (error) {
    const status = Number((error as { statusCode?: number }).statusCode)
    throw createError({ statusCode: [401, 403, 404, 503].includes(status) ? status : 502, message: 'Organization data unavailable' })
  }
}
export async function currentOrganization(event: H3Event) {
  const profile = record(await fetchOrganizationRead(event, 'org-profile.read'))
  return { companyCode: code(profile.tenantCode), companyName: text(profile.orgName) }
}
export function projectOrganizationList(value: unknown, company: ConsoleOrganizationRead['company'], kind: 'domains' | 'regions'): ConsoleOrganizationRead {
  const rows = list(value)
  if (rows.some(row => row.companyCode !== company.companyCode)) throw invalid()
  return {
    company, domains: kind === 'domains'
      ? rows.map(row => ({
          domainCode: code(row.domainCode), domainName: text(row.domainName), displayName: text(row.displayName), aliasName: nullableText(row.aliasName),
          category: ['2G', '2B', '2C'].includes(String(row.category)) ? String(row.category) : 'unknown',
          source: ['preset', 'custom'].includes(String(row.source)) ? String(row.source) : 'unknown', sortOrder: number(row.sortOrder)
        }))
      : [],
    regions: kind === 'regions' ? rows.map(row => ({ regionCode: code(row.regionCode), regionName: text(row.regionName), description: nullableText(row.description), sortOrder: number(row.sortOrder), divisionCount: Math.max(0, number(row.divisionCount)) })) : []
  }
}
export function projectRegionDivisions(value: unknown): ConsoleRegionDivision[] {
  return list(value).map(row => ({ divisionCode: code(row.divisionCode), divisionName: nullableText(row.divisionName), includeChildren: row.includeChildren === true }))
}
