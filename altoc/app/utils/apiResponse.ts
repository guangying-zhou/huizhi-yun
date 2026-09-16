export interface NormalizedPage<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function numberValue(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isPageRecord(record: Record<string, unknown>) {
  return (Array.isArray(record.items) || Array.isArray(record.data))
    && ('total' in record || 'page' in record || 'pageSize' in record)
}

export function unwrapApiData<T = unknown>(payload: unknown): T | unknown {
  const record = recordOf(payload)
  if (record && isPageRecord(record)) return payload
  return record && 'data' in record ? record.data : payload
}

export function unwrapApiList<T = unknown>(payload: unknown): T[] {
  const body = unwrapApiData(payload)
  if (Array.isArray(body)) return body as T[]

  const record = recordOf(body)
  if (!record) return []

  if (Array.isArray(record.items)) return record.items as T[]
  if (Array.isArray(record.data)) return record.data as T[]
  return []
}

export function unwrapApiPage<T = unknown>(payload: unknown): NormalizedPage<T> {
  const body = unwrapApiData(payload)
  const record = recordOf(body)
  const items = unwrapApiList<T>(body)

  return {
    items,
    total: numberValue(record?.total, items.length),
    page: numberValue(record?.page, 1),
    pageSize: numberValue(record?.pageSize, items.length)
  }
}
