import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, parsePagination } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface PlanRow extends RowDataPacket {
  id: number
  plan_code: string
  plan_name: string
  plan_tier: string
  price_model: string
  base_price: string | null
  currency: string | null
  billing_cycle: string | null
  description: string | null
  status: string
  created_at: string
  updated_at: string
  app_count: number
  capability_count: number
  active_subscriber_count: number
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const keyword = normalizeNullableString(query.keyword)
  const tier = normalizeNullableString(query.tier)
  const status = normalizeNullableString(query.status)
  const { page, pageSize, offset } = parsePagination(query)

  const where: string[] = ['1 = 1']
  const params: Array<string | number> = []

  if (tier) {
    where.push('p.plan_tier = ?')
    params.push(tier)
  }

  if (status) {
    where.push('p.status = ?')
    params.push(status)
  }

  if (keyword) {
    where.push('(p.plan_code LIKE ? OR p.plan_name LIKE ? OR COALESCE(p.description, \'\') LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`

  const rows = await queryRows<PlanRow[]>(
    `SELECT p.id,
            p.plan_code,
            p.plan_name,
            p.plan_tier,
            p.price_model,
            p.base_price,
            p.currency,
            p.billing_cycle,
            p.description,
            p.status,
            p.created_at,
            p.updated_at,
            (SELECT COUNT(*) FROM platform_plan_apps ppa WHERE ppa.plan_id = p.id) AS app_count,
            (SELECT COUNT(*) FROM platform_plan_capabilities ppc WHERE ppc.plan_id = p.id) AS capability_count,
            (SELECT COUNT(*) FROM tenant_subscriptions ts
              WHERE ts.plan_code = p.plan_code AND ts.status = 'active') AS active_subscriber_count
     FROM platform_plans p
     ${whereSql}
     ORDER BY FIELD(p.plan_tier, 'starter', 'standard', 'advanced', 'enterprise') ASC, p.plan_code ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  )

  const totalRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total FROM platform_plans p ${whereSql}`,
    params
  )

  return ok({
    items: rows.map(row => ({
      id: row.id,
      planCode: row.plan_code,
      planName: row.plan_name,
      planTier: row.plan_tier,
      priceModel: row.price_model,
      basePrice: row.base_price !== null ? Number(row.base_price) : null,
      currency: row.currency,
      billingCycle: row.billing_cycle,
      description: row.description,
      status: row.status,
      appCount: Number(row.app_count) || 0,
      capabilityCount: Number(row.capability_count) || 0,
      activeSubscriberCount: Number(row.active_subscriber_count) || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })),
    total: totalRow?.total || 0,
    page,
    pageSize
  })
})
