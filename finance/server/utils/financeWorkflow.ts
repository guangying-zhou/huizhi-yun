import type { H3Event } from 'h3'
import type { RowDataPacket } from '~~/server/utils/db'
import { getRequestHeaders } from 'h3'
import { resolveWorkflowApiUrl } from '@hzy/foundation/server/utils/workflowRuntime'
import type { ApprovalBizType, ApprovalTargetConfig } from './financeApproval'
import { cleanString } from './financeWrite'

type WorkflowActionConfig = {
  resourceCode: string
  actionCode: string
  listPath: string
}

type WorkflowPrepareResponse = {
  code?: number
  message?: string
  data?: {
    action_def?: {
      id?: number
    }
    matched_routes?: Array<{
      id?: number
      name?: string
    }>
  }
}

type WorkflowCreateResponse = {
  code?: number
  message?: string
  data?: {
    instance_id?: number | string
    instance_no?: string
    status?: string
  }
}

export type WorkflowSubmissionResult = {
  workflowInstanceId: string
  externalInstanceId: string | null
  platform: 'workflow' | 'local'
  status: string
  errorMessage: string | null
}

const workflowActionMap: Record<ApprovalBizType, WorkflowActionConfig> = {
  invoice_request: {
    resourceCode: 'invoices',
    actionCode: 'request',
    listPath: '/invoices/requests'
  },
  expense_claim: {
    resourceCode: 'expenses',
    actionCode: 'claim',
    listPath: '/expenses/claims'
  },
  project_expense_request: {
    resourceCode: 'expenses',
    actionCode: 'project_expense',
    listPath: '/expenses/projects'
  },
  payment_request: {
    resourceCode: 'expenses',
    actionCode: 'payment',
    listPath: '/payments/requests'
  }
}

export function resolveApprovalBizTypeByWorkflow(resourceCode: string | null, actionCode: string | null) {
  const normalizedResource = cleanString(resourceCode)
  const normalizedAction = cleanString(actionCode)
  if (!normalizedResource || !normalizedAction) return null

  const entry = Object.entries(workflowActionMap).find(([, item]) => {
    return item.resourceCode === normalizedResource && item.actionCode === normalizedAction
  })

  return (entry?.[0] as ApprovalBizType | undefined) || null
}

export async function createWorkflowApprovalInstance(
  event: H3Event,
  target: ApprovalTargetConfig,
  row: RowDataPacket,
  body: Record<string, unknown>
): Promise<WorkflowSubmissionResult> {
  const actionConfig = workflowActionMap[target.bizType]
  const baseUrl = await resolveWorkflowApiUrl()
  const headers = forwardedWorkflowHeaders(event)
  const formData = buildFormData(row, body)
  const bizTitle = buildBizTitle(row, target)
  const bizContext = buildBizContext(target, row, body)

  const prepare = await $fetch<WorkflowPrepareResponse>(`${baseUrl}/api/v1/instances/prepare`, {
    method: 'POST',
    headers,
    body: {
      app_code: 'finance',
      resource_code: actionConfig.resourceCode,
      action_code: actionConfig.actionCode,
      biz_id: row.code,
      biz_title: bizTitle,
      biz_context: bizContext,
      form_data: formData
    },
    timeout: 10000
  })

  if (prepare.code !== 0) {
    throw new Error(prepare.message || `Workflow prepare failed: code=${prepare.code ?? 'unknown'}`)
  }

  const actionDefId = prepare.data?.action_def?.id
  const routeId = prepare.data?.matched_routes?.[0]?.id
  if (!actionDefId || !routeId) {
    throw new Error('Workflow 未匹配到可用审批路由')
  }

  const created = await $fetch<WorkflowCreateResponse>(`${baseUrl}/api/v1/instances`, {
    method: 'POST',
    headers,
    body: {
      action_def_id: actionDefId,
      route_id: routeId,
      biz_id: row.code,
      biz_title: bizTitle,
      biz_url: `${financePublicBaseUrl()}${actionConfig.listPath}`,
      biz_context: bizContext,
      form_data: formData,
      attachments: [],
      callback_url: `${financePublicBaseUrl()}/api/v1/finance/workflow/callback`
    },
    timeout: 10000
  })

  if (created.code !== 0) {
    throw new Error(created.message || `Workflow create failed: code=${created.code ?? 'unknown'}`)
  }

  const workflowInstanceId = cleanString(created.data?.instance_id)
  if (!workflowInstanceId) {
    throw new Error('Workflow 创建实例成功但未返回 instance_id')
  }

  return {
    workflowInstanceId,
    externalInstanceId: cleanString(created.data?.instance_no),
    platform: 'workflow',
    status: cleanString(created.data?.status) || 'running',
    errorMessage: null
  }
}

export function createLocalWorkflowFallback(target: ApprovalTargetConfig, code: string, error: unknown): WorkflowSubmissionResult {
  return {
    workflowInstanceId: `finance-${target.bizType}-${code}`,
    externalInstanceId: null,
    platform: 'local',
    status: 'pending',
    errorMessage: error instanceof Error ? error.message : String(error || 'Workflow unavailable')
  }
}

function forwardedWorkflowHeaders(event: H3Event) {
  const incoming = getRequestHeaders(event)
  const headers: Record<string, string> = {}
  for (const name of ['authorization', 'cookie', 'x-request-id', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']) {
    const value = incoming[name]
    if (typeof value === 'string' && value.trim()) {
      headers[name] = value
    }
  }
  return headers
}

function buildBizTitle(row: RowDataPacket, target: ApprovalTargetConfig) {
  return cleanString(row.title)
    || cleanString(row.invoice_item)
    || cleanString(row.customer_name)
    || cleanString(row.payee_name)
    || `${target.codePrefix}-${row.code}`
}

function buildBizContext(target: ApprovalTargetConfig, row: RowDataPacket, body: Record<string, unknown>) {
  return {
    app_code: 'finance',
    biz_type: target.bizType,
    biz_code: row.code,
    amount: cleanString(row.requested_amount) || cleanString(row.total_amount) || cleanString(row.approved_amount),
    currency_code: cleanString(row.currency_code) || 'CNY',
    project_code: cleanString(row.project_code),
    contract_code: cleanString(row.contract_code),
    customer_code: cleanString(row.customer_code),
    department_code: cleanString(row.applicant_dept_code),
    resource_dept_code: cleanString(row.applicant_dept_code),
    submitted_comment: cleanString(body.comment ?? body.submitComment ?? body.submit_comment)
  }
}

function buildFormData(row: RowDataPacket, body: Record<string, unknown>) {
  const formData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (key === 'deleted_at') continue
    formData[key] = value instanceof Date ? value.toISOString() : value
  }
  formData.submit_comment = cleanString(body.comment ?? body.submitComment ?? body.submit_comment)
  return formData
}

function financePublicBaseUrl() {
  const config = useRuntimeConfig() as unknown as {
    public?: {
      appHomeUrl?: string
      deploymentPublicUrl?: string
      appBasePath?: string
    }
  }
  const appHomeUrl = cleanString(config.public?.appHomeUrl)
  if (appHomeUrl) return appHomeUrl.replace(/\/+$/, '')

  const deploymentPublicUrl = (cleanString(config.public?.deploymentPublicUrl) || '').replace(/\/+$/, '')
  const appBasePath = cleanString(config.public?.appBasePath) || '/finance/'
  if (deploymentPublicUrl) {
    return `${deploymentPublicUrl}${appBasePath.startsWith('/') ? appBasePath : `/${appBasePath}`}`.replace(/\/+$/, '')
  }

  return (cleanString(process.env.NUXT_PUBLIC_SITE_URL) || '').replace(/\/+$/, '') || 'http://localhost:3006/finance'
}
