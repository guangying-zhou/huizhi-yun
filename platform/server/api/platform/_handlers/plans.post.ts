import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'

const ALLOWED_TIERS = new Set(['starter', 'standard', 'advanced', 'enterprise'])
const ALLOWED_PRICE_MODELS = new Set(['fixed', 'metered', 'custom'])
const ALLOWED_STATUSES = new Set(['active', 'suspended', 'disabled', 'draft'])
const ALLOWED_ROLES_IN_PLAN = new Set(['core', 'business'])

interface AppInput {
  appCode: string
  roleInPlan: 'core' | 'business'
  pinReleaseId: number | null
  sortOrder: number
}

interface CapabilityInput {
  capabilityCode: string
  capabilityValue: string | null
}

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

function parseApps(raw: unknown): AppInput[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw createError({ statusCode: 400, message: `apps[${index}] is invalid` })
    }
    const record = item as Record<string, unknown>
    const appCode = requireString(record.appCode, `apps[${index}].appCode`)
    const roleInPlan = requireAllowed(
      String(record.roleInPlan || 'business'),
      `apps[${index}].roleInPlan`,
      ALLOWED_ROLES_IN_PLAN
    ) as 'core' | 'business'
    const pinReleaseIdRaw = record.pinReleaseId
    const pinReleaseId = pinReleaseIdRaw === null || pinReleaseIdRaw === undefined || pinReleaseIdRaw === ''
      ? null
      : Number(pinReleaseIdRaw)
    if (pinReleaseId !== null && !Number.isInteger(pinReleaseId)) {
      throw createError({ statusCode: 400, message: `apps[${index}].pinReleaseId must be an integer` })
    }
    const sortOrderRaw = Number(record.sortOrder || 0)
    return {
      appCode,
      roleInPlan,
      pinReleaseId,
      sortOrder: Number.isFinite(sortOrderRaw) ? sortOrderRaw : 0
    }
  })
}

function parseCapabilities(raw: unknown): CapabilityInput[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw createError({ statusCode: 400, message: `capabilities[${index}] is invalid` })
    }
    const record = item as Record<string, unknown>
    const capabilityCode = requireString(record.capabilityCode, `capabilities[${index}].capabilityCode`)
    const capabilityValue = normalizeNullableString(record.capabilityValue)
    return { capabilityCode, capabilityValue }
  })
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)

  const planCode = requireString(body.planCode, 'planCode').trim()
  const planName = requireString(body.planName, 'planName').trim()
  const planTier = requireAllowed(
    String(body.planTier || 'starter').trim(),
    'planTier',
    ALLOWED_TIERS
  )
  const priceModel = requireAllowed(
    String(body.priceModel || 'fixed').trim(),
    'priceModel',
    ALLOWED_PRICE_MODELS
  )
  const basePriceRaw = body.basePrice
  const basePrice = basePriceRaw === null || basePriceRaw === undefined || basePriceRaw === ''
    ? null
    : Number(basePriceRaw)
  if (basePrice !== null && !Number.isFinite(basePrice)) {
    throw createError({ statusCode: 400, message: 'basePrice must be a number' })
  }
  const currency = normalizeNullableString(body.currency)
  const billingCycle = normalizeNullableString(body.billingCycle)
  const description = normalizeNullableString(body.description)
  const status = requireAllowed(
    String(body.status || 'active').trim(),
    'status',
    ALLOWED_STATUSES
  )

  const apps = parseApps(body.apps)
  const capabilities = parseCapabilities(body.capabilities)

  const appCodes = new Set<string>()
  for (const app of apps) {
    if (appCodes.has(app.appCode)) {
      throw createError({ statusCode: 409, message: `duplicate app: ${app.appCode}` })
    }
    appCodes.add(app.appCode)
  }

  const capabilityCodes = new Set<string>()
  for (const cap of capabilities) {
    if (capabilityCodes.has(cap.capabilityCode)) {
      throw createError({ statusCode: 409, message: `duplicate capability: ${cap.capabilityCode}` })
    }
    capabilityCodes.add(cap.capabilityCode)
  }

  const result = await withTransaction(async (tx) => {
    const existing = await tx.queryRow<RowDataPacket>(
      `SELECT id FROM platform_plans WHERE plan_code = ? LIMIT 1`,
      [planCode]
    )
    if (existing) {
      throw createError({ statusCode: 409, message: `plan already exists: ${planCode}` })
    }

    const insertResult = await tx.execute<ResultSetHeader>(
      `INSERT INTO platform_plans
        (plan_code, plan_name, plan_tier, price_model, base_price, currency, billing_cycle, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [planCode, planName, planTier, priceModel, basePrice, currency, billingCycle, description, status]
    )
    const planId = insertResult.insertId

    for (const app of apps) {
      const appRow = await tx.queryRow<RowDataPacket>(
        `SELECT app_code FROM platform_applications WHERE app_code = ? LIMIT 1`,
        [app.appCode]
      )
      if (!appRow) {
        throw createError({ statusCode: 404, message: `application not found: ${app.appCode}` })
      }
      if (app.pinReleaseId) {
        const releaseRow = await tx.queryRow<RowDataPacket>(
          `SELECT id FROM platform_app_releases WHERE id = ? AND app_code = ? LIMIT 1`,
          [app.pinReleaseId, app.appCode]
        )
        if (!releaseRow) {
          throw createError({
            statusCode: 404,
            message: `release not found for ${app.appCode}: id=${app.pinReleaseId}`
          })
        }
      }
      await tx.execute<ResultSetHeader>(
        `INSERT INTO platform_plan_apps
          (plan_id, app_code, role_in_plan, pin_release_id, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [planId, app.appCode, app.roleInPlan, app.pinReleaseId, app.sortOrder]
      )
    }

    for (const cap of capabilities) {
      const capRow = await tx.queryRow<RowDataPacket>(
        `SELECT capability_code FROM platform_capabilities WHERE capability_code = ? LIMIT 1`,
        [cap.capabilityCode]
      )
      if (!capRow) {
        throw createError({ statusCode: 404, message: `capability not found: ${cap.capabilityCode}` })
      }
      await tx.execute<ResultSetHeader>(
        `INSERT INTO platform_plan_capabilities
          (plan_id, capability_code, capability_value, created_at)
         VALUES (?, ?, ?, NOW())`,
        [planId, cap.capabilityCode, cap.capabilityValue]
      )
    }

    return planId
  })

  return ok({
    id: result,
    planCode,
    planName,
    appCount: apps.length,
    capabilityCount: capabilities.length
  })
})
