import { createError } from 'h3'

export type SqlParam = string | number | boolean | Date | Buffer | null

export const FINANCE_SUBJECT_TYPES = ['asset', 'liability', 'equity', 'cost', 'profit_loss'] as const
export const FINANCE_ACCOUNTING_OBJECT_TYPES = [
  'customer_project',
  'internal_project',
  'department',
  'contract',
  'customer',
  'sales_region',
  'opportunity',
  'sales_campaign',
  'employee',
  'other'
] as const

export const FINANCE_RECEIPT_SOURCE_TYPES = ['contract', 'no_contract', 'pre_contract', 'other'] as const
export const FINANCE_SALES_SCOPE_TYPES = ['region', 'customer', 'opportunity', 'contract', 'sales_campaign', 'general'] as const

export function generateFinanceCode(prefix: string): string {
  const now = new Date()
  const datePart = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('')
  const randomPart = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${prefix}${datePart}${randomPart}`
}

export function cleanString(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text || null
}

export function requiredString(value: unknown, field: string): string {
  const text = cleanString(value)
  if (!text) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} is required`
    })
  }
  return text
}

export function optionalDate(value: unknown): string | null {
  const text = cleanString(value)
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'date must be YYYY-MM-DD'
    })
  }
  return text
}

export function optionalDateTime(value: unknown): string | null {
  const text = cleanString(value)
  if (!text) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} 00:00:00`
  return text
}

export function moneyString(value: unknown, field: string, options: { required?: boolean, positive?: boolean } = {}): string | null {
  if (value === undefined || value === null || value === '') {
    if (options.required) {
      throw createError({
        statusCode: 400,
        statusMessage: `${field} is required`
      })
    }
    return null
  }

  const amount = Number(value)
  if (!Number.isFinite(amount)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be a valid amount`
    })
  }
  if (options.positive && amount <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be greater than 0`
    })
  }
  return amount.toFixed(2)
}

export function numberOrNull(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be a number`
    })
  }
  return numberValue
}

export function jsonOrNull(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function toDbBoolean(value: unknown, defaultValue = true): number {
  if (value === undefined || value === null || value === '') return defaultValue ? 1 : 0
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0
}

export function assertAllowed(value: string | null, field: string, allowed: string[]): string | null {
  if (!value) return value
  if (!allowed.includes(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be one of ${allowed.join(', ')}`
    })
  }
  return value
}
