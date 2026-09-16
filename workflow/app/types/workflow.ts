/**
 * Workflow 流程引擎类型定义
 */

// ========== 审批人定义 ==========
export interface Assignee {
  type: 'user' | 'role' | 'dept_manager' | 'dept_leader' | 'initiator_leader' | 'initiator' | 'form_field' | 'dept_members'
  uid?: string
  uid_from_context?: string
  code?: string
  scope?: 'initiator_dept' | 'resource_dept' | 'specified' | 'form_field'
  dept_code?: string
  field_key?: string
  value_type?: string
  exclude_initiator?: boolean
  sample?: {
    mode?: 'random'
    count?: number
    count_from_field?: string
    seed?: string
  }
}

// ========== 流程节点定义 ==========
export interface FlowNode {
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
  assignees: Assignee[]
  skip_when?: Record<string, unknown>
  timeout_hours?: number
  auto_action?: 'approve' | 'reject'
}

// ========== 流程配置 ==========
export interface FlowConfig {
  allow_withdraw?: boolean
  allow_delegate?: boolean
  allow_add_sign?: boolean
  allow_resubmit?: boolean
  reject_strategy?: 'to_initiator' | 'to_previous'
  notify_channels?: string[]
}

// ========== 流程定义 ==========
export interface FlowSchema {
  id: number
  code: string
  name: string
  description: string | null
  nodes: FlowNode[]
  config: FlowConfig
  version: number
  status: number
  created_by: string
  created_at: string
  updated_at: string
}

// ========== 表单字段定义 ==========
export interface FormField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'select' | 'date' | 'user_picker' | 'dept_picker' | 'file' | 'rich_text'
  required?: boolean
  readonly?: boolean
  source?: string
  default_value?: unknown
  placeholder?: string
  visible_when?: Record<string, unknown>
  help_text?: string
  max_length?: number
  rows?: number
  min?: number
  max?: number
  step?: number
  options?: Array<{ label: string, value: string }>
  multiple?: boolean
  max_count?: number
  accept?: string
  min_date?: string
  max_date?: string
}

// ========== 表单定义 ==========
export interface FormSchema {
  id: number
  code: string
  name: string
  description: string | null
  fields: FormField[]
  version: number
  status: number
  created_by: string
  created_at: string
  updated_at: string
}

// ========== 资源动作定义 ==========
export interface FlowActionDef {
  id: number
  app_code: string
  resource_code: string
  action_code: string
  name: string
  description: string | null
  form_schema_id: number | null
  icon: string | null
  sort_order: number
  status: number
  created_by: string
  created_at: string
  updated_at: string
}

// ========== 路由条件 ==========
export type RouteConditionValue
  = | string
    | number
    | { in?: Array<string | number>, not_in?: Array<string | number>, gte?: number, lte?: number, exists?: boolean }

export type RouteConditions = Record<string, RouteConditionValue>

// ========== 流程路由 ==========
export interface FlowRoute {
  id: number
  action_def_id: number
  flow_schema_id: number
  name: string
  description: string | null
  conditions: RouteConditions
  priority: number
  is_default: number
  status: number
  created_by: string
  created_at: string
  updated_at: string
}

// ========== 附件 ==========
export interface Attachment {
  id: string
  name: string
  url: string
  oss_path?: string
  size: number
  mime_type: string
  uploaded_by?: string
  uploaded_at?: string
}

// ========== 流程实例 ==========
export interface FlowInstance {
  id: number
  instance_no: string
  action_def_id: number
  route_id: number
  flow_schema_id: number
  app_code: string
  resource_code: string
  action_code: string
  biz_id: string
  biz_title: string
  biz_url: string | null
  biz_context: Record<string, unknown>
  form_data: Record<string, unknown>
  attachments: Attachment[]
  initiator_uid: string
  status: 'running' | 'approved' | 'rejected' | 'cancelled' | 'suspended'
  current_node: number
  flow_snapshot: { nodes: FlowSnapshotNode[] }
  callback_url: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface FlowSnapshotNode extends FlowNode {
  resolved_assignees: Array<{
    uid: string
    name: string
    position?: string
  }>
}

// ========== 待办任务 ==========
export interface FlowTask {
  id: number
  instance_id: number
  node_index: number
  node_name: string
  assignee_uid: string
  task_type: 'approve' | 'cc' | 'countersign'
  status: 'pending' | 'completed' | 'skipped' | 'cancelled'
  due_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

// ========== 操作记录 ==========
export interface FlowAction {
  id: number
  instance_id: number
  task_id: number | null
  actor_uid: string
  action: 'approve' | 'reject' | 'delegate' | 'withdraw' | 'remind' | 'resubmit'
  comment: string | null
  attachments: Attachment[] | null
  created_at: string
}
