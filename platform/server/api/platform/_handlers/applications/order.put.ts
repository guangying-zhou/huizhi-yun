import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'

interface OrderInputItem {
  id?: unknown
  appCode?: unknown
  sortOrder?: unknown
}

function normalizeOrderItem(item: unknown, index: number) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `items[${index}] is invalid` })
  }

  const record = item as OrderInputItem
  const id = Number(record.id)
  const appCode = String(record.appCode || '').trim()
  const sortOrder = Number(record.sortOrder)

  if ((!Number.isFinite(id) || id <= 0) && !appCode) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `items[${index}] requires id or appCode` })
  }

  if (!Number.isFinite(sortOrder) || sortOrder < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `items[${index}].sortOrder must be a non-negative number` })
  }

  return {
    id: Number.isFinite(id) && id > 0 ? Math.trunc(id) : null,
    appCode: appCode || null,
    sortOrder: Math.trunc(sortOrder)
  }
}

function buildLookupClause(items: ReturnType<typeof normalizeOrderItem>[]) {
  const clauses: string[] = []
  const params: Array<number | string> = []

  const ids = [...new Set(items.map(item => item.id).filter((id): id is number => Boolean(id)))]
  const appCodes = [...new Set(items.map(item => item.appCode).filter((appCode): appCode is string => Boolean(appCode)))]

  if (ids.length) {
    clauses.push(`id IN (${ids.map(() => '?').join(', ')})`)
    params.push(...ids)
  }

  if (appCodes.length) {
    clauses.push(`app_code IN (${appCodes.map(() => '?').join(', ')})`)
    params.push(...appCodes)
  }

  return {
    whereSql: clauses.join(' OR '),
    params
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ items?: unknown[] }>(event)
  const normalizedItems = Array.isArray(body.items)
    ? body.items.map(normalizeOrderItem)
    : []

  if (!normalizedItems.length) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'items is required' })
  }

  const seen = new Set<string>()
  for (const item of normalizedItems) {
    const key = item.id ? `id:${item.id}` : `appCode:${item.appCode}`
    if (seen.has(key)) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `duplicate application order item: ${key}` })
    }
    seen.add(key)
  }

  const result = await withTransaction(async (tx) => {
    const lookup = buildLookupClause(normalizedItems)
    const existing = await tx.queryRows<Array<RowDataPacket & { id: number, app_code: string }>>(
      `SELECT id, app_code
       FROM platform_applications
       WHERE ${lookup.whereSql}
       FOR UPDATE`,
      lookup.params
    )

    const byId = new Map(existing.map(item => [Number(item.id), item]))
    const byAppCode = new Map(existing.map(item => [String(item.app_code), item]))

    for (const item of normalizedItems) {
      const row = item.id ? byId.get(item.id) : item.appCode ? byAppCode.get(item.appCode) : null
      if (!row) {
        const target = item.id ? `id=${item.id}` : `appCode=${item.appCode}`
        throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `application not found: ${target}` })
      }

      await tx.execute<ResultSetHeader>(
        `UPDATE platform_applications
         SET sort_order = ?, updated_at = NOW()
         WHERE id = ?`,
        [item.sortOrder, row.id]
      )
    }

    return { updated: normalizedItems.length }
  })

  return ok(result)
})
