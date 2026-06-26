/**
 * Aims 模块类型定义
 * 基于 aims_schema.sql 数据库表结构
 */

// ============================================================
// 枚举联合类型
// ============================================================

export type ProjectCategory
  = | 'product_dev'
    | 'custom_dev'
    | 'delivery'
    | 'maintenance'
    | 'sales'
    | 'presales'
    | 'improvement'
    | 'compliance'

export type Methodology = 'PIVR' | 'agile' | 'waterfall' | 'kanban' | 'hybrid'

export type LifecycleStatus
  = | 'draft'
    | 'approval_pending'
    | 'active'
    | 'paused'
    | 'completed'
    | 'archived'

export type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected'

export type ProjectRole = 'manager' | 'member' | 'viewer'

export type ProjectSecurityLevel = 'company' | 'department' | 'project_team' | 'whitelist'

export type WorkItemType = 'requirement' | 'task' | 'bug'

export type WorkItemTier = 'target' | 'matter'

export type Priority = 'P0' | 'P1' | 'P2' | 'P3'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'suggestion'

/** Target 层状态：planning → todo → in_progress → in_review → completed */
export type TargetStatus = 'planning' | 'todo' | 'in_progress' | 'in_review' | 'completed'

/** Matter 层状态：todo → in_progress → in_review → completed */
export type MatterStatus = 'todo' | 'in_progress' | 'in_review' | 'completed'

// 兼容旧类型引用
export type RequirementStatus = TargetStatus
export type TaskStatus = MatterStatus
export type BugStatus = TargetStatus

export type RelationType = 'blocks' | 'blocked_by' | 'relates_to'

export type MilestoneMode = 'strong_constraint' | 'rolling_plan' | 'periodic'

export type PivrStage = 'P' | 'I' | 'V' | 'R'

export type WorkflowEntityType = 'project' | 'milestone' | 'task' | 'bug'

// ============================================================
// 1. 项目 (aims_projects)
// ============================================================

// ============================================================
// 项目集 (project_portfolios)
// ============================================================

export type PortfolioStatus = 'active' | 'archived'

export interface ProjectPortfolio {
  id: number
  code: string
  name: string
  description: string | null
  domainCode: string | null
  ownerUid: string | null
  deptCode: string | null
  gitGroup: string | null
  isProductLine: boolean
  displayOrder: number
  status: PortfolioStatus
  createdBy: string
  createdAt: string
  updatedAt: string
  /** 前端展示用 */
  projectCount?: number
  ownerName?: string
}

/** 模块开关配置 */
export interface ModuleConfig {
  /** 里程碑模块开关(关闭后项目以纯看板模式运行) */
  milestonesEnabled?: boolean
  /** 流程审计开关(关闭后状态跳转无需审批) */
  processAuditEnabled?: boolean
}

export interface AimsProject {
  id: number
  projectCode: string
  name: string
  shortName: string
  internalCode: string | null
  description: string | null
  category: ProjectCategory
  methodology: Methodology
  lifecycleStatus: LifecycleStatus
  portfolioId: number | null
  domainCode: string | null
  deptCode: string | null
  leaderUid: string | null
  securityLevel: ProjectSecurityLevel
  accessWhitelist: string[]
  startDate: string | null
  endDate: string | null
  oppId: number | null
  contractId: number | null
  customerCode: string | null
  customerName: string | null
  contractCode: string | null
  templateSetId?: number | null
  templateSetName?: string | null
  templateVersionId?: number | null
  templateVersionLabel?: string | null
  approvalStatus: ApprovalStatus
  workflowInstanceId: string | null
  moduleConfig: ModuleConfig | null
  boardConfig: Record<string, unknown> | null
  workflowConfig: Record<string, unknown> | null
  notificationConfig: Record<string, unknown> | null
  createdBy: string
  createdAt: string
  updatedAt: string
  /** 当前登录用户是否可进入该项目 */
  canAccess?: boolean
  /** 当前登录用户在项目内的角色；无项目成员权限时为 null */
  currentUserRole?: ProjectRole | null
  /** 项目文档数 */
  documentCount?: number
}

// ============================================================
// 2. 项目成员 (aims_project_members)
// ============================================================

export type MemberStatus = 'active' | 'suspended'

export interface ProjectMember {
  id: number
  projectId: number
  uid: string
  role: ProjectRole
  status: MemberStatus
  joinedAt: string
  /** 前端展示用，接口 JOIN 返回 */
  realName?: string
  avatar?: string | null
}

// ============================================================
// 3. 项目-仓库关联 (aims_project_repos)
// ============================================================

export interface ProjectRepo {
  id: number
  projectId: number
  repoProjectCode: string
  lastCommitSha: string | null
  lastSyncedAt: string | null
  createdAt: string
}

// ============================================================
// 4. 工作项编号计数器 (project_counters)
// ============================================================

export interface ProjectCounter {
  id: number
  projectId: number
  counter: number
  createdAt: string
  updatedAt: string
}

// ============================================================
// 5. 工作流状态转换 (workflow_transitions)
// ============================================================

export interface WorkflowTransition {
  id: number
  projectId: number | null
  entityType: WorkflowEntityType
  fromStatus: string
  toStatus: string
  transitionKey: string
  isInitial: boolean
  createdAt: string
}

// ============================================================
// 6. 里程碑 (milestones)
// ============================================================

export type MilestoneStatus = 'planning' | 'todo' | 'active' | 'completed'

/** 交付物检查项(强约束模式) */
export interface MilestoneDeliverable {
  name: string
  required: boolean
  completed: boolean
}

export interface Milestone {
  id: number
  projectId: number
  templateKey?: string | null
  name: string
  description: string | null
  mode: MilestoneMode
  pivrStage: PivrStage | null
  paymentTermId: number | null
  startDate: string | null
  endDate: string | null
  status: MilestoneStatus
  deliverables: MilestoneDeliverable[] | null
  recurrenceRule: string | null
  sortOrder: number
  createdBy: string | null
  createdAt: string
  updatedAt: string
  /** 里程碑进度(Roll-up计算) */
  progress?: number
}

// ============================================================
// 7. 工作项 (work_items)
// ============================================================

export interface WorkItem {
  id: number
  projectId: number
  milestoneId: number
  itemNumber: number
  itemKey: string
  type: WorkItemType
  tier: WorkItemTier
  title: string
  description: string | null
  startDate: string | null
  status: string
  priority: Priority
  severity: Severity | null
  weight: number
  assigneeUid: string | null
  reporterUid: string | null
  dueDate: string | null
  estimatedHours: number | null
  parentId: number | null
  versionId: number | null
  featureId: number | null
  sortOrder: number
  required?: boolean
  templateKey?: string | null
  approvalStatus: ApprovalStatus
  workflowInstanceId: string | null
  createdAt: string
  updatedAt: string
  /** 前端展示用，接口 JOIN 返回 */
  assigneeName?: string
  reporterName?: string
  milestoneName?: string
  versionCode?: string | null
  featureTitle?: string | null
  children?: WorkItem[]
}

// ============================================================
// 8. 工作项关联关系 (work_item_relations)
// ============================================================

export interface WorkItemRelation {
  id: number
  sourceId: number
  targetId: number
  relationType: RelationType
  createdAt: string
  /** 前端展示用 */
  targetItemKey?: string
  targetTitle?: string
}

// ============================================================
// 9. 工作项评论 (work_item_comments)
// ============================================================

export interface WorkItemComment {
  id: number
  workItemId: number
  authorUid: string
  content: string
  createdAt: string
  updatedAt: string
  /** 前端展示用 */
  authorName?: string
  authorAvatar?: string | null
}

// ============================================================
// 10. 工作项变更日志 (work_item_changelog)
// ============================================================

export interface WorkItemChangelog {
  id: number
  workItemId: number
  fieldName: string
  oldValue: string | null
  newValue: string | null
  changedBy: string
  changedAt: string
  /** 前端展示用 */
  changedByName?: string
}

// ============================================================
// 11. 工作项附件 (work_item_attachments)
// ============================================================

export interface WorkItemAttachment {
  id: number
  workItemId: number
  fileName: string
  ossKey: string
  fileSize: number
  contentType: string | null
  uploadedBy: string
  uploadedAt: string
  /** 前端展示用 */
  uploadedByName?: string
  /** 签名下载 URL（按需生成） */
  downloadUrl?: string
}

// ============================================================
// 12. 工作项文档视图（基于 project_documents.work_item_id）
// ============================================================

export interface WorkItemDocument {
  id: number
  workItemId: number
  documentId: string
  linkedBy: string
  linkedAt: string
  /** 前端展示用 */
  documentTitle?: string
}

// ============================================================
// 13. 工时记录 (time_entries)
// ============================================================

export interface TimeEntry {
  id: number
  projectId: number
  workItemId: number | null
  uid: string
  entryDate: string
  hours: number
  description: string | null
  createdAt: string
  updatedAt: string
  /** 前端展示用 */
  userName?: string
  itemKey?: string
  itemTitle?: string
  projectCode?: string
  projectName?: string
  projectShortName?: string
}

// ============================================================
// 14. GitLab 提交关联 (gitlab_commits)
// ============================================================

export interface GitlabCommit {
  id: number
  projectId: number
  workItemId: number | null
  itemKey: string | null
  repoProjectCode: string
  commitSha: string
  message: string
  authorName: string | null
  authorEmail: string | null
  committedAt: string
  syncedAt: string
}

// ============================================================
// 15. 通知规则 (notification_rules)
// ============================================================

export interface NotificationRule {
  id: number
  projectId: number
  eventType: string
  enabled: boolean
  config: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

// ============================================================
// 16. 系统参数 (system_parameters)
// ============================================================

export interface SystemParameter {
  id: number
  paramKey: string
  paramValue: string
  description: string | null
  createdAt: string
  updatedAt: string
}

// ============================================================
// API 请求类型
// ============================================================

/** 创建项目集 */
export interface CreatePortfolioRequest {
  code: string
  name: string
  description?: string | null
  domainCode?: string | null
  ownerUid?: string | null
  deptCode?: string | null
  gitGroup?: string | null
  isProductLine?: boolean
  displayOrder?: number
}

/** 更新项目集 */
export interface UpdatePortfolioRequest {
  name?: string
  description?: string | null
  domainCode?: string | null
  ownerUid?: string | null
  deptCode?: string | null
  gitGroup?: string | null
  isProductLine?: boolean
  displayOrder?: number
  status?: PortfolioStatus
}

/** 创建项目 */
export interface CreateProjectRequest {
  projectCode: string
  name: string
  shortName: string
  internalCode?: string | null
  description?: string | null
  category?: ProjectCategory
  methodology?: Methodology
  portfolioId?: number | null
  domainCode?: string | null
  deptCode?: string | null
  leaderUid?: string | null
  securityLevel?: ProjectSecurityLevel
  accessWhitelist?: string[]
  startDate?: string | null
  endDate?: string | null
  oppId?: number | null
  contractId?: number | null
  customerCode?: string | null
  customerName?: string | null
  contractCode?: string | null
  templateVersionId?: number | null
  excludedWorkItemKeys?: string[]
}

/** 更新项目 */
export interface UpdateProjectRequest {
  name?: string
  shortName?: string
  internalCode?: string | null
  description?: string | null
  category?: ProjectCategory
  methodology?: Methodology
  lifecycleStatus?: LifecycleStatus
  portfolioId?: number | null
  domainCode?: string | null
  deptCode?: string | null
  leaderUid?: string | null
  securityLevel?: ProjectSecurityLevel
  accessWhitelist?: string[]
  startDate?: string | null
  endDate?: string | null
  oppId?: number | null
  contractId?: number | null
  customerCode?: string | null
  customerName?: string | null
  contractCode?: string | null
  moduleConfig?: ModuleConfig | null
  boardConfig?: Record<string, unknown> | null
  workflowConfig?: Record<string, unknown> | null
  notificationConfig?: Record<string, unknown> | null
}

/** 添加项目成员 */
export interface AddProjectMemberRequest {
  uid: string
  role?: ProjectRole
}

/** 关联仓库 */
export interface LinkRepoRequest {
  repoProjectCode: string
}

/** 创建里程碑 */
export interface CreateMilestoneRequest {
  name: string
  description?: string | null
  mode?: MilestoneMode
  pivrStage?: PivrStage | null
  paymentTermId?: number | null
  startDate?: string | null
  endDate?: string | null
  deliverables?: MilestoneDeliverable[] | null
  recurrenceRule?: string | null
}

/** 更新里程碑 */
export interface UpdateMilestoneRequest {
  name?: string
  description?: string | null
  mode?: MilestoneMode
  pivrStage?: PivrStage | null
  paymentTermId?: number | null
  startDate?: string | null
  endDate?: string | null
  status?: MilestoneStatus
  deliverables?: MilestoneDeliverable[] | null
  recurrenceRule?: string | null
  sortOrder?: number
}

/** 创建工作项 */
export interface CreateWorkItemRequest {
  type: WorkItemType
  tier?: WorkItemTier
  title: string
  milestoneId: number
  description?: string | null
  startDate?: string | null
  priority?: Priority
  severity?: Severity | null
  weight?: number
  assigneeUid?: string | null
  reporterUid?: string | null
  dueDate?: string | null
  estimatedHours?: number | null
  parentId?: number | null
  versionId?: number | null
  featureId?: number | null
  required?: boolean
  templateKey?: string | null
}

/** 更新工作项 */
export interface UpdateWorkItemRequest {
  title?: string
  tier?: WorkItemTier
  description?: string | null
  milestoneId?: number
  startDate?: string | null
  status?: string
  priority?: Priority
  severity?: Severity | null
  weight?: number
  assigneeUid?: string | null
  reporterUid?: string | null
  dueDate?: string | null
  estimatedHours?: number | null
  parentId?: number | null
  versionId?: number | null
  featureId?: number | null
  sortOrder?: number
  required?: boolean
  templateKey?: string | null
}

export type ProjectTemplateVersionStatus = 'draft' | 'published' | 'archived'

export type ProjectTemplateDeliverableType = 'document' | 'code' | 'artifact' | 'task'

export interface ProjectTemplateDeliverableDefinition {
  key: string
  name: string
  description?: string | null
  acceptanceCriteria: string
  deliverableType: ProjectTemplateDeliverableType
  required: boolean
  sortOrder: number
}

export interface ProjectTemplateWorkItemDefinition {
  key: string
  title: string
  type: WorkItemType
  tier: WorkItemTier
  description?: string | null
  required: boolean
  reviewLevel: number
  priority: Priority
  sortOrder: number
  deliverables: ProjectTemplateDeliverableDefinition[]
}

export interface ProjectTemplateMilestoneDefinition {
  key: string
  name: string
  description?: string | null
  mode: MilestoneMode
  pivrStage: PivrStage
  sortOrder: number
  workItems: ProjectTemplateWorkItemDefinition[]
}

export interface ProjectTemplateDefinition {
  milestones: ProjectTemplateMilestoneDefinition[]
}

export interface ProjectTemplateVersionSummary {
  id: number
  templateSetId: number
  templateSetCode: string
  templateSetName: string
  category: ProjectCategory
  versionNo: number
  versionLabel: string
  status: ProjectTemplateVersionStatus
  usageCount: number
  isSystem: boolean
  notes: string | null
  publishedAt: string | null
  archivedAt: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface ProjectTemplateVersionDetail extends ProjectTemplateVersionSummary {
  definition: ProjectTemplateDefinition
}

/** 创建工作项关联 */
export interface CreateWorkItemRelationRequest {
  targetId: number
  relationType: RelationType
}

/** 创建评论 */
export interface CreateCommentRequest {
  content: string
}

/** 更新评论 */
export interface UpdateCommentRequest {
  content: string
}

/** 记录工时 */
export interface CreateTimeEntryRequest {
  projectId: number
  workItemId?: number | null
  entryDate: string
  hours: number
  description?: string | null
}

/** 更新工时 */
export interface UpdateTimeEntryRequest {
  entryDate?: string
  hours?: number
  description?: string | null
}

/** 关联文档 */
export interface LinkDocumentRequest {
  documentId: string
}

/** 创建/更新通知规则 */
export interface UpsertNotificationRuleRequest {
  eventType: string
  enabled: boolean
  config?: Record<string, unknown> | null
}

// ============================================================
// API 查询参数类型
// ============================================================

/** 项目列表查询 */
export interface ProjectListQuery {
  page?: number
  pageSize?: number
  keyword?: string
  search?: string
  category?: ProjectCategory
  lifecycleStatus?: LifecycleStatus
  portfolioId?: number
  domainCode?: string
  deptCode?: string
  leaderUid?: string
}

/** 工作项列表查询 */
export interface WorkItemListQuery {
  page?: number
  pageSize?: number
  keyword?: string
  search?: string
  type?: WorkItemType
  status?: string
  priority?: Priority
  severity?: Severity
  milestoneId?: number
  assigneeUid?: string
  reporterUid?: string
  parentId?: number | null
  versionId?: number | '__null__'
}

/** 工时查询 */
export interface TimeEntryQuery {
  page?: number
  pageSize?: number
  uid?: string
  projectId?: number
  startDate?: string
  endDate?: string
  workItemId?: number
}

// ============================================================
// API 响应类型
// ============================================================

/** 分页列表响应 */
export interface PaginatedList<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/** 项目详情（含关联数据） */
export interface AimsProjectDetail extends AimsProject {
  members?: ProjectMember[]
  repos?: ProjectRepo[]
  /** 当前用户在项目中的角色 */
  currentUserRole?: ProjectRole | null
}

/** 工作项详情（含关联数据） */
export interface WorkItemDetail extends WorkItem {
  comments?: WorkItemComment[]
  attachments?: WorkItemAttachment[]
  relations?: WorkItemRelation[]
  documents?: WorkItemDocument[]
  changelog?: WorkItemChangelog[]
  timeEntries?: TimeEntry[]
  commits?: GitlabCommit[]
}
