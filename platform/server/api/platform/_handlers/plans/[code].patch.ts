import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'

const ALLOWED_TIERS = new Set(['starter', 'standard', 'advanced', 'enterprise'])
const ALLOWED_PRICE_MODELS = new Set(['fixed', 'metered', 'custom'])
const ALLOWED_STATUSES = new Set(['active', 'suspended', 'disabled', 'draft'])
const ALLOWED_ROLES_IN_PLAN = new Set(['core', 'business'])

function requireAllowed(value: string, field: string, allowed: Set<string>) {
  if (!allowed.has(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `${field} must be one of: ${Array.from(allowed).join(', ')}`
    })
  }
  return value
}

export default defineEventHandler(async (event) => {
  const planCode = requireString(getRouterParam(event, 'code'), 'planCode')
  const body = await readBody<Record<string, unknown>>(event)

  const updates: string[] = []
  const params: Array<string | number | null> = []

  if (body.planName !== undefined) {
    updates.push('plan_name = ?')
    params.push(requireString(body.planName, 'planName').trim())
  }
  if (body.planTier !== undefined) {
    updates.push('plan_tier = ?')
    params.push(requireAllowed(String(body.planTier).trim(), 'planTier', ALLOWED_TIERS))
  }
  if (body.priceModel !== undefined) {
    updates.push('price_model = ?')
    params.push(requireAllowed(String(body.priceModel).trim(), 'priceModel', ALLOWED_PRICE_MODELS))
  }
  if (body.basePrice !== undefined) {
    const raw = body.basePrice
    const value = raw === null || raw === '' ? null : Number(raw)
    if (value !== null && !Number.isFinite(value)) {
      throw createError({ statusCode: 400, message: 'basePrice must be a number' })
    }
    updates.push('base_price = ?')
    params.push(value)
  }
  if (body.currency !== undefined) {
    updates.push('currency = ?')
    params.push(normalizeNullableString(body.currency))
  }
  if (body.billingCycle !== undefined) {
    updates.push('billing_cycle = ?')
    params.push(normalizeNullableString(body.billingCycle))
  }
  if (body.description !== undefined) {
    updates.push('description = ?')
    params.push(normalizeNullableString(body.description))
  }
  if (body.status !== undefined) {
    updates.push('status = ?')
    params.push(requireAllowed(String(body.status).trim(), 'status', ALLOWED_STATUSES))
  }

  const replaceApps = Array.isArray(body.apps)
  const replaceCaps = Array.isArray(body.capabilities)

  await withTransaction(async (tx) => {
    const plan = await tx.queryRow<RowDataPacket & { id: number }>(
      `SELECT id FROM platform_plans WHERE plan_code = ? LIMIT 1`,
      [planCode]
    )
    if (!plan) {
      throw createError({ statusCode: 404, message: `plan not found: ${planCode}` })
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()')
      await tx.execute<ResultSetHeader>(
        `UPDATE platform_plans SET ${updates.join(', ')} WHERE id = ?`,
        [...params, plan.id]
      )
    }

    if (replaceApps) {
      await tx.execute<ResultSetHeader>(
        `DELETE FROM platform_plan_apps WHERE plan_id = ?`,
        [plan.id]
      )
      const apps = body.apps as Array<Record<string, unknown>>
      const appCodes = new Set<string>()
      for (const [index, app] of apps.entries()) {
        if (!app || typeof app !== 'object') {
          throw createError({ statusCode: 400, message: `apps[${index}] is invalid` })
        }
        const appCode = requireString(app.appCode, `apps[${index}].appCode`)
        if (appCodes.has(appCode)) {
          throw createError({ statusCode: 409, message: `duplicate app: ${appCode}` })
        }
        appCodes.add(appCode)

        const roleInPlan = requireAllowed(
          String(app.roleInPlan || 'business'),
          `apps[${index}].roleInPlan`,
          ALLOWED_ROLES_IN_PLAN
        )
        const pinReleaseIdRaw = app.pinReleaseId
        const pinReleaseId = pinReleaseIdRaw === null || pinReleaseIdRaw === undefined || pinReleaseIdRaw === ''
          ? null
          : Number(pinReleaseIdRaw)
        if (pinReleaseId !== null && !Number.isInteger(pinReleaseId)) {
          throw createError({ statusCode: 400, message: `apps[${index}].pinReleaseId must be an integer` })
        }
        const sortOrder = Number(app.sortOrder || 0) || 0

        const appRow = await tx.queryRow<RowDataPacket>(
          `SELECT app_code FROM platform_applications WHERE app_code = ? LIMIT 1`,
          [appCode]
        )
        if (!appRow) {
          throw createError({ statusCode: 404, message: `application not found: ${appCode}` })
        }
        if (pinReleaseId) {
          const releaseRow = await tx.queryRow<RowDataPacket>(
            `SELECT id FROM platform_app_releases WHERE id = ? AND app_code = ? LIMIT 1`,
            [pinReleaseId, appCode]
          )
          if (!releaseRow) {
            throw createError({
              statusCode: 404,
              message: `release not found for ${appCode}: id=${pinReleaseId}`
            })
          }
        }
        await tx.execute<ResultSetHeader>(
          `INSERT INTO platform_plan_apps
            (plan_id, app_code, role_in_plan, pin_release_id, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [plan.id, appCode, roleInPlan, pinReleaseId, sortOrder]
        )
      }
    }

    if (replaceCaps) {
      await tx.execute<ResultSetHeader>(
        `DELETE FROM platform_plan_capabilities WHERE plan_id = ?`,
        [plan.id]
      )
      const caps = body.capabilities as Array<Record<string, unknown>>
      const capabilityCodes = new Set<string>()
      for (const [index, cap] of caps.entries()) {
        if (!cap || typeof cap !== 'object') {
          throw createError({ statusCode: 400, message: `capabilities[${index}] is invalid` })
        }
        const capabilityCode = requireString(cap.capabilityCode, `capabilities[${index}].capabilityCode`)
        if (capabilityCodes.has(capabilityCode)) {
          throw createError({ statusCode: 409, message: `duplicate capability: ${capabilityCode}` })
        }
        capabilityCodes.add(capabilityCode)

        const capabilityValue = normalizeNullableString(cap.capabilityValue)

        const capRow = await tx.queryRow<RowDataPacket>(
          `SELECT capability_code FROM platform_capabilities WHERE capability_code = ? LIMIT 1`,
          [capabilityCode]
        )
        if (!capRow) {
          throw createError({ statusCode: 404, message: `capability not found: ${capabilityCode}` })
        }
        await tx.execute<ResultSetHeader>(
          `INSERT INTO platform_plan_capabilities
            (plan_id, capability_code, capability_value, created_at)
           VALUES (?, ?, ?, NOW())`,
          [plan.id, capabilityCode, capabilityValue]
        )
      }
    }

    if (updates.length === 0 && (replaceApps || replaceCaps)) {
      await tx.execute<ResultSetHeader>(
        `UPDATE platform_plans SET updated_at = NOW() WHERE id = ?`,
        [plan.id]
      )
    }
  })

  return ok({ planCode, updated: true })
})
