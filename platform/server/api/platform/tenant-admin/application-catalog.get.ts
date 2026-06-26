import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface CurrentPlanRow extends RowDataPacket {
  plan_code: string
  plan_name: string | null
  plan_tier: string | null
}

interface CatalogAppRow extends RowDataPacket {
  app_code: string
  app_name: string
  description: string | null
  icon: string | null
  required_plan_code: string | null
  required_plan_name: string | null
  required_plan_tier: string | null
  in_current_plan: number
}

export default defineEventHandler(async (event) => {
  const tenantCode = String(event.context.platformTenantCode || '').trim()
  if (!tenantCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenant context is missing'
    })
  }

  const current = await queryRow<CurrentPlanRow>(
    `SELECT ts.plan_code,
            pp.plan_name,
            pp.plan_tier
       FROM tenant_subscriptions ts
       LEFT JOIN platform_plans pp ON pp.plan_code = ts.plan_code
      WHERE ts.tenant_code = ?
        AND ts.status = 'active'
      ORDER BY ts.updated_at DESC, ts.id DESC
      LIMIT 1`,
    [tenantCode]
  )

  const currentPlanCode = current?.plan_code || ''

  const apps = await queryRows<CatalogAppRow[]>(
    `SELECT a.app_code,
            a.app_name,
            a.description,
            a.icon,
            (SELECT p.plan_code
               FROM platform_plan_apps ppa
               JOIN platform_plans p ON p.id = ppa.plan_id AND p.status = 'active'
              WHERE ppa.app_code = a.app_code
              ORDER BY FIELD(p.plan_tier, 'starter', 'standard', 'pro', 'advanced', 'enterprise') ASC, p.plan_code ASC
              LIMIT 1) AS required_plan_code,
            (SELECT p.plan_name
               FROM platform_plan_apps ppa
               JOIN platform_plans p ON p.id = ppa.plan_id AND p.status = 'active'
              WHERE ppa.app_code = a.app_code
              ORDER BY FIELD(p.plan_tier, 'starter', 'standard', 'pro', 'advanced', 'enterprise') ASC, p.plan_code ASC
              LIMIT 1) AS required_plan_name,
            (SELECT p.plan_tier
               FROM platform_plan_apps ppa
               JOIN platform_plans p ON p.id = ppa.plan_id AND p.status = 'active'
              WHERE ppa.app_code = a.app_code
              ORDER BY FIELD(p.plan_tier, 'starter', 'standard', 'pro', 'advanced', 'enterprise') ASC, p.plan_code ASC
              LIMIT 1) AS required_plan_tier,
            EXISTS(SELECT 1
                     FROM platform_plan_apps ppa
                     JOIN platform_plans p ON p.id = ppa.plan_id
                    WHERE ppa.app_code = a.app_code
                      AND p.plan_code = ?) AS in_current_plan
       FROM platform_applications a
      WHERE a.service_role = 'business_app'
        AND a.status = 'active'
      ORDER BY a.sort_order ASC, a.app_code ASC`,
    [currentPlanCode]
  )

  return ok({
    currentPlan: current
      ? {
          planCode: current.plan_code,
          planName: current.plan_name,
          planTier: current.plan_tier
        }
      : null,
    applications: apps.map(app => ({
      appCode: app.app_code,
      appName: app.app_name,
      description: app.description,
      icon: app.icon,
      enabled: Boolean(app.in_current_plan),
      requiredPlan: app.required_plan_code
        ? {
            planCode: app.required_plan_code,
            planName: app.required_plan_name,
            planTier: app.required_plan_tier
          }
        : null
    }))
  })
})
