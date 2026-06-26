/**
 * Workflow 流程相关类型定义
 */

/** 流程实例状态 */
export type WorkflowStatus = 'running' | 'approved' | 'rejected' | 'cancelled' | 'suspended'

/** 操作能力集 */
export interface WorkflowCapabilities {
  can_approve: boolean
  can_reject: boolean
  can_delegate: boolean
  can_cancel: boolean
  can_resubmit: boolean
  can_comment: boolean
}

/** 业务视图信息 */
export interface WorkflowBusinessView {
  mode: 'local' | 'iframe' | 'external-link'
  app_code: string
  resource_code: string
  biz_id: string
  biz_url: string | null
  embed_url: string | null
}

/** 审批动作记录（时间线条目） */
export interface WorkflowAction {
  id?: number
  task_id?: number
  node_index?: number
  node_name: string
  actor_uid: string
  action: 'submit' | 'approve' | 'reject' | 'delegate' | 'cancel' | 'resubmit' | 'remind'
  comment: string | null
  attachments?: unknown[] | null
  created_at: string
}

/** 流程快照中的节点 */
export interface WorkflowSnapshotNode {
  name: string
  type: 'approve' | 'cc' | 'countersign'
  approve_mode?: 'any' | 'all' | 'count' | 'ratio'
  approve_threshold?: {
    count?: number
    ratio?: number
    round?: 'ceil' | 'floor_plus_one' | 'floor'
    min?: number
    max?: number
  }
  resolved_assignees: Array<{ uid: string, name?: string, position?: string }>
  skip_when?: Record<string, unknown>
}

/** 任务 */
export interface WorkflowTask {
  id: number
  instance_id: number
  node_index: number
  node_name: string
  assignee_uid: string
  task_type: string
  status: 'pending' | 'completed' | 'skipped' | 'cancelled'
  due_at: string | null
  completed_at: string | null
  created_at: string
}

/** 流程实例 */
export interface WorkflowInstance {
  id: number
  instance_no: string
  app_code: string
  resource_code: string
  action_code: string
  action_name?: string | null
  biz_id: string
  biz_title: string
  biz_url: string | null
  biz_context?: Record<string, unknown>
  form_data?: Record<string, unknown>
  attachments?: unknown[]
  initiator_uid: string
  status: WorkflowStatus
  current_node: number
  flow_snapshot: { nodes: WorkflowSnapshotNode[], config?: Record<string, unknown> }
  completed_at: string | null
  created_at: string
  updated_at?: string
}

/** 任务详情 API 返回 */
export interface WorkflowTaskDetail {
  task: WorkflowTask
  instance: WorkflowInstance
  tasks: WorkflowTask[]
  actions: WorkflowAction[]
  capabilities: WorkflowCapabilities
  business_view: WorkflowBusinessView
}

/** 实例详情 API 返回（与 TaskDetail 中的 instance 类似但多了 tasks/actions） */
export interface WorkflowInstanceDetail extends WorkflowInstance {
  tasks: WorkflowTask[]
  actions: WorkflowAction[]
  capabilities: WorkflowCapabilities
  business_view: WorkflowBusinessView
}

/** by-biz 查询返回 */
export interface WorkflowByBizResult {
  instance_id: number
  instance_no: string
  app_code: string
  resource_code: string
  action_code: string
  biz_id: string
  biz_title: string
  biz_url: string | null
  initiator_uid: string
  status: WorkflowStatus
  current_node: number
  flow_snapshot: { nodes: WorkflowSnapshotNode[], config?: Record<string, unknown> }
  created_at: string
  completed_at: string | null
  actions: WorkflowAction[]
  capabilities: WorkflowCapabilities | null
}

/** 待办/已办列表项 */
export interface WorkflowTaskItem {
  task_id: number
  instance_id: number
  instance_no: string
  app_code: string
  resource_code: string
  action_code: string
  action_name: string | null
  biz_title: string
  biz_url: string | null
  initiator_uid: string
  node_name: string
  task_type: string
  created_at: string
  due_at?: string | null
  completed_at?: string | null
  instance_status?: string
}

/** 我发起的列表项 */
export interface WorkflowInitiatedItem {
  instance_id: number
  instance_no: string
  app_code: string
  resource_code: string
  action_code: string
  action_name: string | null
  biz_title: string
  biz_url: string | null
  status: WorkflowStatus
  current_node: number
  created_at: string
  completed_at: string | null
}

/** 分页响应 */
export interface WorkflowPagedResponse<T> {
  total: number
  items: T[]
}

/** 发起审批的 payload */
export interface WorkflowLaunchPayload {
  appCode: string
  resourceCode: string
  bizId: string
  actionCode: string
  bizTitle: string
  /** 审批动作显示名称（如"立项审批"），用于面板标题 */
  actionName?: string
  bizUrl?: string
  bizContext?: Record<string, unknown>
  formData?: Record<string, unknown>
  callbackUrl?: string
}

export interface PageWorkflowCallbackPayload {
  instanceId: number
  taskId?: number
  instanceStatus?: string
}

/** 页面级流程动作定义（多动作模式） */
export interface PageWorkflowAction {
  /** 动作编码（如 initiation / pause / close / restart） */
  actionCode: string
  /** 动作显示名称（如"立项申请"、"项目暂停"） */
  actionName: string
  /** 动作图标（Nuxt UI icon 名称，可选） */
  icon?: string
  /** 页面是否满足该动作的提交条件 */
  canSubmit: Ref<boolean> | ComputedRef<boolean>
  /** 该动作的完整性检查问题列表 */
  completenessIssues: Ref<string[]> | ComputedRef<string[]>
  /** 提交前钩子 */
  beforeSubmit?: () => Promise<void>
  /** 发起审批时写入 Workflow 的表单数据 */
  formData?: Ref<Record<string, unknown>> | ComputedRef<Record<string, unknown>>
  /** 流程终态回调地址 */
  callbackUrl?: Ref<string> | ComputedRef<string>
  /** 提交成功后回调 */
  onSubmitted?: (payload: PageWorkflowCallbackPayload) => Promise<void> | void
  /** 审批通过后回调 */
  onApproved?: (payload: PageWorkflowCallbackPayload) => Promise<void> | void
  /** 审批驳回后回调 */
  onRejected?: (payload: PageWorkflowCallbackPayload) => Promise<void> | void
}
