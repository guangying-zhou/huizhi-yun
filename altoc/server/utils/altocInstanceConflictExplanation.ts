import { createError, type H3Event } from 'h3'
import {
  loadInstanceConflictExplanationFromConsoleRuntime,
  type RuntimeInstanceConflictExplainResult
} from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode, type PermissionAction } from '~~/app/config/permissions'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'

type AltocInstanceConflictTargetType = 'quotation' | 'contract' | 'receivable'
type AltocInstanceConflictAction = 'approve' | 'confirm'

interface AltocInstanceConflictInput {
  targetType: unknown
  id?: unknown
  code?: unknown
  action?: unknown
  includeBaseline?: unknown
}

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface AltocInstanceConflictTarget {
  targetType: AltocInstanceConflictTargetType
  resourceCode: 'quotation' | 'contract' | 'receivable'
  defaultAction: AltocInstanceConflictAction
  detailPath: (id: string) => string
}

export interface AltocInstanceConflictExplanation {
  targetType: AltocInstanceConflictTargetType
  id: string
  code: string | null
  action: AltocInstanceConflictAction
  principals: Array<{
    kind: string
    uid: string
  }>
  explanation: RuntimeInstanceConflictExplainResult
}

const altocConflictTargets: Record<AltocInstanceConflictTargetType, AltocInstanceConflictTarget> = {
  quotation: {
    targetType: 'quotation',
    resourceCode: 'quotation',
    defaultAction: 'approve',
    detailPath: id => `/v1/altoc/quotes/${encodeURIComponent(id)}`
  },
  contract: {
    targetType: 'contract',
    resourceCode: 'contract',
    defaultAction: 'approve',
    detailPath: id => `/v1/altoc/contracts/${encodeURIComponent(id)}`
  },
  receivable: {
    targetType: 'receivable',
    resourceCode: 'receivable',
    defaultAction: 'confirm',
    detailPath: id => `/v1/altoc/payments/${encodeURIComponent(id)}`
  }
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function booleanValue(value: unknown, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(stringValue(value).toLowerCase())
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function firstObject(...values: unknown[]) {
  for (const value of values) {
    const record = objectRecord(value)
    if (Object.keys(record).length > 0) return record
  }
  return {}
}

function firstString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(row[key])
    if (value) return value
  }
  return ''
}

function targetConfig(value: unknown): AltocInstanceConflictTarget {
  const targetType = stringValue(value) as AltocInstanceConflictTargetType
  const config = altocConflictTargets[targetType]
  if (!config) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'targetType must be quotation, contract or receivable'
    })
  }
  return config
}

function actionValue(value: unknown, fallback: AltocInstanceConflictAction): AltocInstanceConflictAction {
  const action = stringValue(value).toLowerCase()
  if (!action) return fallback
  if (action === fallback) return action
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message: `action must be ${fallback}`
  })
}

function targetCode(target: AltocInstanceConflictTarget, id: string, row: Record<string, unknown>) {
  if (target.targetType === 'quotation') {
    return firstString(row, ['quotation_code', 'quotationCode', 'quote_code', 'quoteCode', 'code', 'quote_no', 'quoteNo']) || id
  }
  if (target.targetType === 'contract') {
    return firstString(row, ['contract_code', 'contractCode', 'code', 'contract_no', 'contractNo']) || id
  }
  return firstString(row, ['receivable_plan_code', 'receivablePlanCode', 'plan_code', 'planCode', 'payment_code', 'paymentCode', 'code']) || id
}

function ownerUidForTarget(target: AltocInstanceConflictTarget, row: Record<string, unknown>) {
  if (target.targetType === 'quotation') {
    return firstString(row, [
      'owner_uid',
      'ownerUid',
      'owner_user_id',
      'ownerUserId',
      'sales_owner_uid',
      'salesOwnerUid',
      'sales_uid',
      'salesUid',
      'created_by',
      'createdBy'
    ])
  }

  if (target.targetType === 'contract') {
    return firstString(row, [
      'owner_uid',
      'ownerUid',
      'owner_user_id',
      'ownerUserId',
      'sales_owner_uid',
      'salesOwnerUid',
      'manager_uid',
      'managerUid',
      'created_by',
      'createdBy'
    ])
  }

  return firstString(row, [
    'owner_uid',
    'ownerUid',
    'owner_user_id',
    'ownerUserId',
    'collector_uid',
    'collectorUid',
    'handler_uid',
    'handlerUid',
    'created_by',
    'createdBy'
  ])
}

function requesterUidForTarget(target: AltocInstanceConflictTarget, row: Record<string, unknown>) {
  const commonRequester = [
    'applicant_uid',
    'applicantUid',
    'requester_uid',
    'requesterUid',
    'submitted_by',
    'submittedBy',
    'created_by',
    'createdBy'
  ]

  if (target.targetType === 'receivable') {
    return firstString(row, ['maker_uid', 'makerUid', 'created_by', 'createdBy'])
  }

  return firstString(row, commonRequester)
}

export function buildAltocInstanceConflictObject(
  uid: string,
  target: AltocInstanceConflictTarget,
  id: string,
  row: Record<string, unknown>
) {
  const code = targetCode(target, id, row)
  return {
    actorUid: uid,
    ownerUid: ownerUidForTarget(target, row) || null,
    departmentCode: firstString(row, [
      'owner_dept_code',
      'ownerDeptCode',
      'sales_dept_code',
      'salesDeptCode',
      'department_code',
      'departmentCode',
      'dept_code',
      'deptCode'
    ]) || null,
    projectCode: firstString(row, ['project_code', 'projectCode']) || null,
    customerCode: firstString(row, ['customer_code', 'customerCode']) || null,
    contractCode: firstString(row, ['contract_code', 'contractCode']) || null,
    receivablePlanCode: target.targetType === 'receivable' ? code : null,
    matchedRelations: [
      `altoc:${target.targetType}:${code}`
    ]
  }
}

export function buildAltocInstanceConflictPrincipals(
  target: AltocInstanceConflictTarget,
  row: Record<string, unknown>
) {
  const principals: Array<{ kind: string, uid: string }> = []
  const seen = new Set<string>()
  const push = (kind: string, uid: string) => {
    const normalizedUid = stringValue(uid)
    const key = `${kind}:${normalizedUid}`
    if (!normalizedUid || seen.has(key)) return
    principals.push({ kind, uid: normalizedUid })
    seen.add(key)
  }

  const requesterUid = requesterUidForTarget(target, row)
  const ownerUid = ownerUidForTarget(target, row)
  if (target.targetType === 'receivable') {
    const collectorUid = firstString(row, ['collector_uid', 'collectorUid', 'handler_uid', 'handlerUid'])
    const confirmedBy = firstString(row, ['confirmed_by', 'confirmedBy'])
    push('maker', requesterUid)
    push('owner', ownerUid)
    push('collector', collectorUid)
    if (confirmedBy && confirmedBy !== requesterUid && confirmedBy !== ownerUid && confirmedBy !== collectorUid) {
      push('confirmer', confirmedBy)
    }
    return principals
  }

  push('requester', requesterUid)
  push('owner', ownerUid)
  return principals
}

function extractRuntimeRow(payload: unknown) {
  const data = objectRecord(payload)
  return firstObject(
    data.item,
    data.detail,
    data.quotation,
    data.quote,
    data.contract,
    data.payment,
    data.receivable_plan,
    data.receivablePlan,
    data
  )
}

async function loadAltocConflictTargetRow(
  event: H3Event,
  target: AltocInstanceConflictTarget,
  id: string
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<Record<string, unknown>>>(
    event,
    target.detailPath(id),
    {
      appCode,
      scope: `altoc.read altoc:${target.resourceCode}:view`,
      method: 'GET',
      query: await resolveCurrentAltocDataAccessQuery(event, target.resourceCode, 'view' as PermissionAction)
    }
  )

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Altoc Runtime Unavailable',
      message: 'Altoc tenant-runtime is required for instance conflict explanation.'
    })
  }

  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({
      statusCode: 502,
      message: runtime.data.message || 'Altoc tenant-runtime returned an error.'
    })
  }

  const row = extractRuntimeRow(runtime.data.data)
  if (!Object.keys(row).length) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'Altoc target object not found.'
    })
  }

  return row
}

export async function explainAltocInstanceConflicts(
  event: H3Event,
  input: AltocInstanceConflictInput
): Promise<AltocInstanceConflictExplanation> {
  const uid = requireRequestUid(event)
  const target = targetConfig(input.targetType)
  const id = stringValue(input.id || input.code)
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'id is required' })
  }

  const action = actionValue(input.action, target.defaultAction)
  const row = await loadAltocConflictTargetRow(event, target, id)
  const principals = buildAltocInstanceConflictPrincipals(target, row)
  const explanation = await loadInstanceConflictExplanationFromConsoleRuntime(event, uid, appCode, {
    resourceCode: target.resourceCode,
    action,
    includeBaseline: booleanValue(input.includeBaseline, true),
    object: buildAltocInstanceConflictObject(uid, target, id, row),
    principals
  })

  return {
    targetType: target.targetType,
    id,
    code: targetCode(target, id, row),
    action,
    principals,
    explanation
  }
}
