import type { RowDataPacket } from 'mysql2/promise'
import { ok, requireString } from '~~/server/utils/api'
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
}

interface PlanAppRow extends RowDataPacket {
  id: number
  app_code: string
  app_name: string
  service_role: string
  role_in_plan: string
  pin_release_id: number | null
  pin_release_version: string | null
  latest_release_version: string | null
  sort_order: number
}

interface PlanCapabilityRow extends RowDataPacket {
  id: number
  capability_code: string
  capability_name: string
  capability_type: string
  capability_value: string | null
  description: string | null
}

interface SubscriberRow extends RowDataPacket {
  tenant_code: string
  tenant_name: string
  status: string
  started_at: string | null
  ended_at: string | null
}

export default defineEventHandler(async (event) => {
  const planCode = requireString(getRouterParam(event, 'code'), 'planCode')

  const plan = await queryRow<PlanRow>(
    `SELECT id, plan_code, plan_name, plan_tier, price_model, base_price,
            currency, billing_cycle, description, status, created_at, updated_at
     FROM platform_plans
     WHERE plan_code = ?
     LIMIT 1`,
    [planCode]
  )

  if (!plan) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `plan not found: planCode=${planCode}`
    })
  }

  const apps = await queryRows<PlanAppRow[]>(
    `SELECT ppa.id,
            ppa.app_code,
            pa.app_name,
            pa.service_role,
            ppa.role_in_plan,
            ppa.pin_release_id,
            pr.release_version AS pin_release_version,
            (SELECT release_version FROM platform_app_releases
              WHERE app_code = pa.app_code AND status = 'released'
              ORDER BY released_at DESC LIMIT 1) AS latest_release_version,
            ppa.sort_order
     FROM platform_plan_apps ppa
     INNER JOIN platform_applications pa ON pa.app_code = ppa.app_code
     LEFT JOIN platform_app_releases pr ON pr.id = ppa.pin_release_id
     WHERE ppa.plan_id = ?
     ORDER BY ppa.role_in_plan ASC, ppa.sort_order ASC, ppa.app_code ASC`,
    [plan.id]
  )

  const capabilities = await queryRows<PlanCapabilityRow[]>(
    `SELECT ppc.id,
            ppc.capability_code,
            pc.capability_name,
            pc.capability_type,
            ppc.capability_value,
            pc.description
     FROM platform_plan_capabilities ppc
     INNER JOIN platform_capabilities pc ON pc.capability_code = ppc.capability_code
     WHERE ppc.plan_id = ?
     ORDER BY pc.capability_type ASC, ppc.capability_code ASC`,
    [plan.id]
  )

  const subscribers = await queryRows<SubscriberRow[]>(
    `SELECT ts.tenant_code, t.tenant_name, ts.status, ts.started_at, ts.ended_at
     FROM tenant_subscriptions ts
     INNER JOIN tenants t ON t.tenant_code = ts.tenant_code
     WHERE ts.plan_code = ?
     ORDER BY ts.status ASC, ts.started_at DESC
     LIMIT 100`,
    [plan.plan_code]
  )

  return ok({
    plan: {
      id: plan.id,
      planCode: plan.plan_code,
      planName: plan.plan_name,
      planTier: plan.plan_tier,
      priceModel: plan.price_model,
      basePrice: plan.base_price !== null ? Number(plan.base_price) : null,
      currency: plan.currency,
      billingCycle: plan.billing_cycle,
      description: plan.description,
      status: plan.status,
      createdAt: plan.created_at,
      updatedAt: plan.updated_at
    },
    apps: apps.map(row => ({
      id: row.id,
      appCode: row.app_code,
      appName: row.app_name,
      serviceRole: row.service_role,
      roleInPlan: row.role_in_plan,
      pinReleaseId: row.pin_release_id,
      pinReleaseVersion: row.pin_release_version,
      latestReleaseVersion: row.latest_release_version,
      sortOrder: row.sort_order
    })),
    capabilities: capabilities.map(row => ({
      id: row.id,
      capabilityCode: row.capability_code,
      capabilityName: row.capability_name,
      capabilityType: row.capability_type,
      capabilityValue: row.capability_value,
      description: row.description
    })),
    subscribers: subscribers.map(row => ({
      tenantCode: row.tenant_code,
      tenantName: row.tenant_name,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at
    }))
  })
})
