/**
 * Workflow API 封装
 * 所有流程相关 API 调用通过 /api/workflow-proxy 转发到 Workflow 服务
 */
import type {
  WorkflowTaskDetail,
  WorkflowInstanceDetail,
  WorkflowByBizResult,
  WorkflowTaskItem,
  WorkflowInitiatedItem,
  WorkflowPagedResponse
} from '../types/workflow'

const PROXY_BASE = '/api/workflow-proxy'

interface ApiResponse<T> {
  code: number
  message?: string
  data: T
}

/**
 * 查询待办任务
 */
export async function fetchPendingTasks(params?: { app_code?: string, page?: number, page_size?: number }) {
  return $fetch<ApiResponse<WorkflowPagedResponse<WorkflowTaskItem>>>(`${PROXY_BASE}/tasks/pending`, {
    params
  })
}

/**
 * 查询已办任务
 */
export async function fetchDoneTasks(params?: { app_code?: string, page?: number, page_size?: number }) {
  return $fetch<ApiResponse<WorkflowPagedResponse<WorkflowTaskItem>>>(`${PROXY_BASE}/tasks/done`, {
    params
  })
}

/**
 * 查询我发起的
 */
export async function fetchInitiatedTasks(params?: { app_code?: string, status?: string, page?: number, page_size?: number }) {
  return $fetch<ApiResponse<WorkflowPagedResponse<WorkflowInitiatedItem>>>(`${PROXY_BASE}/tasks/initiated`, {
    params
  })
}

/**
 * 查询任务详情（含 capabilities 和 business_view）
 */
export async function fetchTaskDetail(taskId: number | string) {
  return $fetch<ApiResponse<WorkflowTaskDetail>>(`${PROXY_BASE}/tasks/${taskId}`)
}

/**
 * 查询实例详情（含 capabilities 和 business_view）
 */
export async function fetchInstanceDetail(instanceId: number | string) {
  return $fetch<ApiResponse<WorkflowInstanceDetail>>(`${PROXY_BASE}/instances/${instanceId}`)
}

/**
 * 按 biz_key 查询流程实例
 */
export async function fetchInstanceByBiz(params: {
  app_code: string
  resource_code: string
  biz_id: string
  action_code: string
  include_history?: boolean
}) {
  return $fetch<ApiResponse<WorkflowByBizResult | null>>(`${PROXY_BASE}/instances/by-biz`, {
    params: {
      ...params,
      include_history: params.include_history ? 'true' : undefined
    }
  })
}

/**
 * 准备发起流程（匹配路由、获取表单）
 */
export async function prepareInstance(body: {
  app_code: string
  resource_code: string
  action_code: string
  biz_id?: string
  biz_title?: string
  biz_url?: string
  biz_context?: Record<string, unknown>
  form_data?: Record<string, unknown>
}) {
  return $fetch<ApiResponse<Record<string, unknown>>>(`${PROXY_BASE}/instances/prepare`, {
    method: 'POST',
    body
  })
}

/**
 * 正式发起流程
 */
export async function createInstance(body: {
  action_def_id: number
  route_id: number
  biz_id: string
  biz_title: string
  biz_url?: string
  biz_context?: Record<string, unknown>
  form_data?: Record<string, unknown>
  attachments?: unknown[]
  callback_url?: string
}) {
  return $fetch<ApiResponse<{
    instance_id: number
    instance_no: string
    status: string
    current_node: number
    mode?: 'created' | 'resubmitted'
  }>>(`${PROXY_BASE}/instances`, {
    method: 'POST',
    body
  })
}

/**
 * 审批通过
 */
export async function approveTask(taskId: number | string, body?: { comment?: string, attachments?: unknown[] }) {
  return $fetch<ApiResponse<{
    task_id: number
    instance_id: number
    instance_status: string
    next_node: { name: string, assignees: Array<{ uid: string, name: string }> } | null
  }>>(`${PROXY_BASE}/tasks/${taskId}/approve`, {
    method: 'POST',
    body: body || {}
  })
}

/**
 * 审批驳回
 */
export async function rejectTask(taskId: number | string, body: { comment: string }) {
  return $fetch<ApiResponse<{
    task_id: number
    instance_id: number
    reject_strategy: string
  }>>(`${PROXY_BASE}/tasks/${taskId}/reject`, {
    method: 'POST',
    body
  })
}

/** 审批历史条目 */
export interface WorkflowHistoryItem {
  instance_id: number
  instance_no: string
  action_code: string
  action_name: string | null
  biz_title: string
  initiator_uid: string
  status: string
  created_at: string
  completed_at: string | null
  actions: Array<{
    actor_uid: string
    action: string
    comment: string | null
    node_name: string
    created_at: string
  }>
}

/**
 * 查询业务实体的所有审批历史
 */
export async function fetchInstanceHistoryByBiz(params: {
  app_code: string
  resource_code: string
  biz_id: string
}) {
  return $fetch<ApiResponse<WorkflowHistoryItem[]>>(`${PROXY_BASE}/instances/by-biz-history`, {
    params
  })
}
