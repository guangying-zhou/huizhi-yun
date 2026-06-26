import type { ResultSetHeader } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'

const ALLOWED_ENFORCEMENT = new Set(['warning', 'enforce'])
const ALLOWED_STATUS = new Set(['active', 'disabled'])

interface PreparedRule {
  ruleCode: string
  ruleName: string
  conflictType: string
  enforcement: string
  leftRoleCode: string | null
  rightRoleCode: string | null
  leftAppCode: string | null
  leftResourceCode: string | null
  leftAction: string | null
  rightAppCode: string | null
  rightResourceCode: string | null
  rightAction: string | null
  description: string | null
  status: string
}

function hasPermissionSide(rule: PreparedRule, side: 'left' | 'right') {
  if (side === 'left') {
    return Boolean(rule.leftAppCode && rule.leftResourceCode && rule.leftAction)
  }
  return Boolean(rule.rightAppCode && rule.rightResourceCode && rule.rightAction)
}

function hasAnyPermissionPart(rule: PreparedRule, side: 'left' | 'right') {
  if (side === 'left') {
    return Boolean(rule.leftAppCode || rule.leftResourceCode || rule.leftAction)
  }
  return Boolean(rule.rightAppCode || rule.rightResourceCode || rule.rightAction)
}

function hasSideConstraint(rule: PreparedRule, side: 'left' | 'right') {
  if (side === 'left') {
    return Boolean(rule.leftRoleCode || hasPermissionSide(rule, 'left'))
  }
  return Boolean(rule.rightRoleCode || hasPermissionSide(rule, 'right'))
}

function prepareRule(item: unknown, index: number): PreparedRule {
  if (!item || typeof item !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `rules[${index}] is invalid`
    })
  }

  const record = item as Record<string, unknown>
  const ruleCode = requireString(record.ruleCode, `rules[${index}].ruleCode`).trim()
  const ruleName = requireString(record.ruleName, `rules[${index}].ruleName`).trim()
  const enforcement = (normalizeNullableString(record.enforcement) || 'warning').trim()
  const status = (normalizeNullableString(record.status) || 'active').trim()
  const rule: PreparedRule = {
    ruleCode,
    ruleName,
    conflictType: (normalizeNullableString(record.conflictType) || 'segregation_of_duties').trim(),
    enforcement,
    leftRoleCode: normalizeNullableString(record.leftRoleCode)?.trim() || null,
    rightRoleCode: normalizeNullableString(record.rightRoleCode)?.trim() || null,
    leftAppCode: normalizeNullableString(record.leftAppCode)?.trim() || null,
    leftResourceCode: normalizeNullableString(record.leftResourceCode)?.trim() || null,
    leftAction: normalizeNullableString(record.leftAction)?.trim() || null,
    rightAppCode: normalizeNullableString(record.rightAppCode)?.trim() || null,
    rightResourceCode: normalizeNullableString(record.rightResourceCode)?.trim() || null,
    rightAction: normalizeNullableString(record.rightAction)?.trim() || null,
    description: normalizeNullableString(record.description)?.trim() || null,
    status
  }

  if (!ALLOWED_ENFORCEMENT.has(rule.enforcement)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `rules[${index}].enforcement must be one of: ${Array.from(ALLOWED_ENFORCEMENT).join(', ')}`
    })
  }

  if (!ALLOWED_STATUS.has(rule.status)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `rules[${index}].status must be one of: ${Array.from(ALLOWED_STATUS).join(', ')}`
    })
  }

  for (const side of ['left', 'right'] as const) {
    if (hasAnyPermissionPart(rule, side) && !hasPermissionSide(rule, side)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `rules[${index}].${side} permission must include appCode, resourceCode and action together`
      })
    }

    if (!hasSideConstraint(rule, side)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: `rules[${index}].${side} side must include roleCode or a full permission triple`
      })
    }
  }

  return rule
}

function isMissingTableError(error: unknown) {
  const err = error as { code?: string, errno?: number, message?: string }
  return err?.code === 'ER_NO_SUCH_TABLE'
    || err?.errno === 1146
    || String(err?.message || '').includes('tenant_role_conflict_rules')
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const rawRules = Array.isArray(body.rules) ? body.rules : null
  if (!rawRules) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'rules must be an array'
    })
  }

  const rules = rawRules.map((item, index) => prepareRule(item, index))
  const seen = new Set<string>()
  for (const rule of rules) {
    if (seen.has(rule.ruleCode)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `duplicate conflict rule: ${rule.ruleCode}`
      })
    }
    seen.add(rule.ruleCode)
  }

  const createdByUid = String(event.context.platformUid || '').trim() || null

  try {
    await withTransaction(async (tx) => {
      await tx.execute<ResultSetHeader>(
        `DELETE FROM tenant_role_conflict_rules
         WHERE tenant_code = ?`,
        [tenantCode]
      )

      for (const rule of rules) {
        await tx.execute<ResultSetHeader>(
          `INSERT INTO tenant_role_conflict_rules
            (tenant_code, rule_code, rule_name, conflict_type, enforcement,
             left_role_code, right_role_code,
             left_app_code, left_resource_code, left_action,
             right_app_code, right_resource_code, right_action,
             description, status, created_by_uid, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
          [
            tenantCode,
            rule.ruleCode,
            rule.ruleName,
            rule.conflictType,
            rule.enforcement,
            rule.leftRoleCode,
            rule.rightRoleCode,
            rule.leftAppCode,
            rule.leftResourceCode,
            rule.leftAction,
            rule.rightAppCode,
            rule.rightResourceCode,
            rule.rightAction,
            rule.description,
            rule.status,
            createdByUid
          ]
        )
      }
    })
  } catch (error) {
    if (!isMissingTableError(error)) throw error

    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: 'tenant_role_conflict_rules migration has not been applied'
    })
  }

  return ok({
    tenantCode,
    total: rules.length
  })
})
