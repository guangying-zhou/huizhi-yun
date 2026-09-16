export function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page || 1) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20) || 20))

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize
  }
}

export function normalizeNullableString(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null
  }

  return String(value)
}

export function requireString(value: unknown, field: string): string {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${field} is required`
    })
  }

  return normalized
}

export function ok<T>(data: T) {
  return {
    success: true,
    data
  }
}
