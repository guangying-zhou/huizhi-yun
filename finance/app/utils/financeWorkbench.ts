import { formatDateTime } from '../../../foundation/app/utils/format.ts'

// View preferences contain only allowlisted columns and enum/date filters, never object data.
export function financeViewColumns(value: unknown, allowed: readonly string[]): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((key): key is string => typeof key === 'string' && allowed.includes(key)))] : []
}
export function financeBusinessDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-')
}
export function financeDateRange(days: number, date = new Date()) {
  return { startDate: financeBusinessDate(new Date(date.getTime() - (days - 1) * 86400000)), endDate: financeBusinessDate(date) }
}

export function financeListRouteQuery(value: Record<string, unknown>, kind: 'entities' | 'accounts' | 'snapshots') {
  const query: Record<string, string> = {}
  const text = (key: string) => typeof value[key] === 'string' && String(value[key]).length <= 200 ? String(value[key]).trim() : ''
  const page = text('page')
  if (/^[1-9]\d{0,5}$/.test(page)) query.page = page
  const search = text('search')
  if (search) query.search = search
  if (kind !== 'snapshots' && ['active', 'inactive', ...(kind === 'accounts' ? ['closed'] : [])].includes(text('status'))) query.status = text('status')
  if (kind !== 'entities') {
    if (/^[\w-]{1,64}$/.test(text('legalEntityCode'))) query.legalEntityCode = text('legalEntityCode')
    if (kind === 'accounts' && ['bank', 'cash', 'third_party', 'internal'].includes(text('accountType'))) query.accountType = text('accountType')
    if (kind === 'snapshots') {
      if (/^[\w-]{1,64}$/.test(text('accountCode'))) query.accountCode = text('accountCode')
      for (const key of ['startDate', 'endDate']) {
        const date = text(key)
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date) query[key] = date
      }
    }
  }
  return query
}

export function financeViewFilters(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  const filters: Record<string, string> = {}
  if (['all', 'active', 'inactive', 'closed'].includes(String(input.status))) filters.status = String(input.status)
  if (['all', 'bank', 'cash', 'third_party', 'internal'].includes(String(input.accountType))) filters.accountType = String(input.accountType)
  for (const key of ['startDate', 'endDate']) {
    const date = input[key]
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date) filters[key] = date
  }
  return filters
}

// Runtime balance-entry DATETIME values are stored in UTC, even without an ISO suffix.
export function financeRecordedTime(value: string) {
  const utc = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value) ? value.replace(' ', 'T') + 'Z' : value
  return formatDateTime(utc, { timeZone: 'Asia/Shanghai' })
}
