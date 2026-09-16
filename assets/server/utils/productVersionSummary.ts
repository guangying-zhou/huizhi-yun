import { createError } from 'h3'

export function productVersionSummaries(value: unknown, productCode: string) {
  if (!Array.isArray(value)) throw createError({ statusCode: 502, message: '产品版本摘要响应无效' })
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw createError({ statusCode: 502, message: '产品版本摘要记录无效' })
    const row = item as Record<string, unknown>
    const id = Number(row.id)
    if (!Number.isSafeInteger(id) || id <= 0 || row.product_code !== productCode
      || typeof row.version_code !== 'string' || !row.version_code
      || typeof row.status !== 'string' || !['planning', 'developing', 'released', 'archived'].includes(row.status)) {
      throw createError({ statusCode: 502, message: '产品版本摘要身份不一致' })
    }
    const result: Record<string, unknown> = { id, product_code: productCode, version_code: row.version_code, status: row.status }
    for (const key of ['name', 'planned_release_date', 'released_at']) {
      if (row[key] === null || typeof row[key] === 'string') result[key] = row[key]
    }
    for (const key of ['feature_count', 'delivered_feature_count']) {
      if (row[key] !== null && row[key] !== undefined && Number.isSafeInteger(Number(row[key])) && Number(row[key]) >= 0) result[key] = Number(row[key])
    }
    return result
  })
}
