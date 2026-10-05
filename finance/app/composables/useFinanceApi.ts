export interface FinanceListResponse<T = Record<string, unknown>> {
  data: T[]
  chartData?: T[]
  total: number
  page: number
  pageSize: number
  summary?: Record<string, unknown>
  warning?: string
}

export interface FinanceDataResponse<T = Record<string, unknown>> {
  data: T
  warning?: string
}

export function financeApiPath(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `/api/v1/finance${normalized}`
}

export function formatMoney(value: unknown) {
  const numberValue = Number(value || 0)
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2
  }).format(Number.isFinite(numberValue) ? numberValue : 0)
}

export function formatPlainDate(value: unknown) {
  const text = String(value || '')
  return text ? text.slice(0, 10) : '-'
}
