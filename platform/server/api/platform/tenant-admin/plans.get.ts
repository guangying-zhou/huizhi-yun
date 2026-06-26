import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface PlanRow extends RowDataPacket {
  id: number
  plan_code: string
  plan_name: string
  plan_tier: string
  status: string
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const keyword = normalizeNullableString(query.keyword)
  const tier = normalizeNullableString(query.tier)
  const status = normalizeNullableString(query.status) || 'active'
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['status = ?']
  const params: Array<string | number> = [status]

  if (tier) {
    where.push('plan_tier = ?')
    params.push(tier)
  }

  if (keyword) {
    where.push('(plan_code LIKE ? OR plan_name LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const rows = await queryRows<PlanRow[]>(
    `SELECT id, plan_code, plan_name, plan_tier, status
     FROM platform_plans
     ${whereSql}
     ORDER BY FIELD(plan_tier, 'starter', 'standard', 'advanced', 'enterprise') ASC, plan_code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total
     FROM platform_plans
     ${whereSql}`,
    params
  )

  return ok({
    items: rows.map(row => ({
      id: row.id,
      planCode: row.plan_code,
      planName: row.plan_name,
      planTier: row.plan_tier,
      status: row.status
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
