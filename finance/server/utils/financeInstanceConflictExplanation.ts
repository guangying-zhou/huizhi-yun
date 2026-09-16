import { createError, type H3Event } from 'h3'
import {
  loadInstanceConflictExplanationFromConsoleRuntime,
  type RuntimeInstanceConflictExplainResult
} from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { appCode } from '~~/app/config/permissions'
import { requireRequestUid } from './authIdentity'
import {
  buildFinanceRuntimeAuthQuery,
  maybeCallFinanceDataRuntime
} from './dataRuntime'

type FinanceInstanceConflictAction = 'approve' | 'confirm'
type FinanceInstanceConflictTargetType
  = | 'expense_claim'
    | 'project_expense_request'
    | 'payment_request'
    | 'finance_expense'

interface FinanceInstanceConflictInput {
  targetType: string
  code: string
  action?: string | null
  includeBaseline?: boolean
}

interface FinanceInstanceConflictTarget {
  targetType: FinanceInstanceConflictTargetType
  detailPath: (code: string) => string
  readScope: string
  defaultAction: FinanceInstanceConflictAction
  principalKinds: string[]
}

interface RuntimeEnvelope<T> {
  data?: T
}

export interface FinanceInstanceConflictExplanation {
  targetType: FinanceInstanceConflictTargetType
  code: string
  action: FinanceInstanceConflictAction
  principals: Array<{
    kind: string
    uid: string
  }>
  explanation: RuntimeInstanceConflictExplainResult
}

const financeConflictTargets: Record<FinanceInstanceConflictTargetType, FinanceInstanceConflictTarget> = {
  expense_claim: {
    targetType: 'expense_claim',
    detailPath: code => `/v1/finance/expense-claims/${encodeURIComponent(code)}`,
    readScope: 'finance.expense_claims.read',
    defaultAction: 'approve',
    principalKinds: ['applicant', 'requester']
  },
  project_expense_request: {
    targetType: 'project_expense_request',
    detailPath: code => `/v1/finance/project-expense-requests/${encodeURIComponent(code)}`,
    readScope: 'finance.project_expense_requests.read',
    defaultAction: 'approve',
    principalKinds: ['applicant', 'requester']
  },
  payment_request: {
    targetType: 'payment_request',
    detailPath: code => `/v1/finance/payment-requests/${encodeURIComponent(code)}`,
    readScope: 'finance.payment_requests.read',
    defaultAction: 'approve',
    principalKinds: ['applicant', 'maker']
  },
  finance_expense: {
    targetType: 'finance_expense',
    detailPath: code => `/v1/finance/expenses/${encodeURIComponent(code)}`,
    readScope: 'finance.expenses.read',
    defaultAction: 'confirm',
    principalKinds: ['maker', 'handler']
  }
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function booleanValue(value: unknown, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(stringValue(value).toLowerCase())
}

function targetConfig(value: string): FinanceInstanceConflictTarget {
  const targetType = stringValue(value) as FinanceInstanceConflictTargetType
  const config = financeConflictTargets[targetType]
  if (!config) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'targetType must be expense_claim, project_expense_request, payment_request or finance_expense'
    })
  }
  return config
}

function actionValue(value: unknown, fallback: FinanceInstanceConflictAction): FinanceInstanceConflictAction {
  const action = stringValue(value).toLowerCase()
  if (!action) return fallback
  if (action === 'approve' || action === 'confirm') return action
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message: 'action must be approve or confirm'
  })
}

function primaryPrincipalUid(targetType: FinanceInstanceConflictTargetType, row: Record<string, unknown>) {
  if (targetType === 'finance_expense') {
    return stringValue(row.handler_user_id || row.handlerUserId || row.created_by || row.createdBy)
  }
  return stringValue(row.applicant_user_id || row.applicantUserId || row.requested_by || row.requestedBy || row.created_by || row.createdBy)
}

function financeObjectContext(uid: string, target: FinanceInstanceConflictTarget, code: string, row: Record<string, unknown>) {
  return {
    actorUid: uid,
    ownerUid: primaryPrincipalUid(target.targetType, row) || null,
    departmentCode: stringValue(row.applicant_dept_code || row.applicantDeptCode || row.department_code || row.departmentCode) || null,
    projectCode: stringValue(row.project_code || row.projectCode) || null,
    matchedRelations: [
      `finance:${target.targetType}:${code}`
    ]
  }
}

function financePrincipals(target: FinanceInstanceConflictTarget, row: Record<string, unknown>) {
  const uid = primaryPrincipalUid(target.targetType, row)
  if (!uid) return []
  return target.principalKinds.map(kind => ({ kind, uid }))
}

async function loadFinanceConflictTargetRow(
  event: H3Event,
  target: FinanceInstanceConflictTarget,
  code: string
) {
  const path = target.detailPath(code)
  const runtime = await maybeCallFinanceDataRuntime<RuntimeEnvelope<Record<string, unknown>>>(
    event,
    path,
    {
      scope: target.readScope,
      method: 'GET',
      query: await buildFinanceRuntimeAuthQuery(event, path, 'GET')
    }
  )

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Finance Runtime Unavailable',
      message: 'Finance tenant-runtime is required for instance conflict explanation.'
    })
  }

  if (!runtime.data.data) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'Finance target object not found.'
    })
  }

  return runtime.data.data
}

export async function explainFinanceInstanceConflicts(
  event: H3Event,
  input: FinanceInstanceConflictInput
): Promise<FinanceInstanceConflictExplanation> {
  const uid = requireRequestUid(event)
  const target = targetConfig(input.targetType)
  const code = stringValue(input.code)
  if (!code) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'code is required' })
  }

  const action = actionValue(input.action, target.defaultAction)
  const row = await loadFinanceConflictTargetRow(event, target, code)
  const principals = financePrincipals(target, row)
  const explanation = await loadInstanceConflictExplanationFromConsoleRuntime(event, uid, appCode, {
    resourceCode: 'expenses',
    action,
    includeBaseline: booleanValue(input.includeBaseline, true),
    object: financeObjectContext(uid, target, code, row),
    principals
  })

  return {
    targetType: target.targetType,
    code,
    action,
    principals,
    explanation
  }
}
