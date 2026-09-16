export interface DateFormatOptions extends Intl.DateTimeFormatOptions {
  locale?: string
  placeholder?: string
}

export interface MoneyFormatOptions extends Intl.NumberFormatOptions {
  locale?: string
  currency?: string
  placeholder?: string
}

function validDate(value: string | number | Date | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value: string | number | Date | null | undefined, options: DateFormatOptions = {}) {
  const date = validDate(value)
  if (!date) return options.placeholder ?? '-'
  const { locale = 'zh-CN', placeholder: _placeholder, ...intlOptions } = options
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...intlOptions
  }).format(date)
}

export function formatDateTime(value: string | number | Date | null | undefined, options: DateFormatOptions = {}) {
  return formatDate(value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...options
  })
}

export function formatMoney(value: string | number | null | undefined, options: MoneyFormatOptions = {}) {
  if (value === null || value === undefined || value === '') return options.placeholder ?? '-'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return options.placeholder ?? '-'
  const {
    locale = 'zh-CN',
    currency = 'CNY',
    placeholder: _placeholder,
    ...intlOptions
  } = options
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...intlOptions
  }).format(amount)
}
