/**
 * AIMS 权限与 manifest 单一数据源。
 *
 * 当前阶段仍保留 routeRules 与审批动作定义，
 * 资源清单只作为 manifest 能力声明，不在 runtime 启动时同步。
 */

export const appCode = 'aims'
export const appName = 'AIMS'

export const manifestResources = [
  { code: 'dashboard', name: '工作台', description: 'AIMS 首页与个人工作台入口', sortOrder: 10, supportedActions: ['view', 'edit', 'admin'] as const },
  { code: 'projects', name: '项目管理', description: '项目列表、详情、成员与仓库管理', sortOrder: 20, supportedActions: ['view', 'edit', 'admin'] as const },
  { code: 'work_items', name: '工作项管理', description: '工作项列表、详情与执行过程', sortOrder: 30, supportedActions: ['view', 'edit', 'admin'] as const },
  { code: 'tasks', name: '任务', description: '任务分解、分发与完成确认', sortOrder: 40, supportedActions: ['view', 'edit', 'admin'] as const },
  { code: 'requirements', name: '需求管理', description: '需求池、评审与基线变更', sortOrder: 50, supportedActions: ['view', 'edit', 'admin'] as const },
  { code: 'milestones', name: '里程碑', description: '里程碑计划与评审', sortOrder: 60, supportedActions: ['view', 'edit', 'admin'] as const },
  { code: 'reports', name: '报表统计', description: '统计报表与分析视图', sortOrder: 70, supportedActions: ['view', 'edit', 'admin'] as const },
  { code: 'project_templates', name: '项目模板', description: '项目模板与流程模板的定义与维护', sortOrder: 80, supportedActions: ['view', 'edit', 'admin'] as const },
  { code: 'admin', name: '系统管理', description: 'AIMS 应用级后台管理', sortOrder: 90, supportedActions: ['view', 'edit', 'admin'] as const }
] as const

export const appManifest = {
  appCode,
  appName,
  appType: 'internal',
  runtimeMode: 'customer-hosted',
  authMode: 'oidc',
  bundleEnabled: true,
  resources: manifestResources,
  recommendedRoles: [
    { code: 'aims:member', name: 'AIMS 普通成员' },
    { code: 'aims:pm', name: 'AIMS 项目经理' },
    { code: 'aims:admin', name: 'AIMS 管理员' }
  ]
} as const

/**
 * 审批动作定义
 * 启动时同步到 Workflow 服务
 */
export const approvalActions = [
  {
    resourceCode: 'projects',
    actionCode: 'initiation',
    name: '项目立项审批',
    description: '新项目立项审批，审核项目可行性、资源匹配和预算',
    icon: 'i-lucide-folder-plus',
    embedUrlPattern: '{app_base_url}/embed/project/{biz_id}',
    sortOrder: 10,
    enabled: true
  },
  {
    resourceCode: 'projects',
    actionCode: 'pause',
    name: '项目暂停审批',
    description: '项目暂停审批，审核暂停原因、影响范围和恢复条件',
    icon: 'i-lucide-pause-circle',
    embedUrlPattern: '{app_base_url}/embed/project/{biz_id}',
    sortOrder: 20,
    enabled: true
  },
  {
    resourceCode: 'projects',
    actionCode: 'resume',
    name: '项目恢复审批',
    description: '项目恢复审批，审核恢复依据、资源准备和后续推进安排',
    icon: 'i-lucide-play-circle',
    embedUrlPattern: '{app_base_url}/embed/project/{biz_id}',
    sortOrder: 30,
    enabled: true
  },
  {
    resourceCode: 'projects',
    actionCode: 'finish',
    name: '项目结项审批',
    description: '项目结项审批，确认交付物完整性和项目完成度',
    icon: 'i-lucide-flag',
    embedUrlPattern: '{app_base_url}/embed/project/{biz_id}',
    sortOrder: 40,
    enabled: true
  },
  {
    resourceCode: 'tasks',
    actionCode: 'distribute',
    name: '确认任务分配',
    description: '项目负责人确认任务分解结果，确认后任务进入待办，分配字段锁定',
    icon: 'i-lucide-git-branch-plus',
    embedUrlPattern: '{app_base_url}/embed/work-item/{biz_id}/breakdown',
    sortOrder: 10,
    enabled: true
  },
  {
    resourceCode: 'tasks',
    actionCode: 'revoke',
    name: '撤回任务分配',
    description: '撤回已确认的任务分配，全部子任务须在待办态，否则不允许撤回',
    icon: 'i-lucide-undo-2',
    embedUrlPattern: '{app_base_url}/embed/work-item/{biz_id}/breakdown',
    sortOrder: 20,
    enabled: true
  },
  {
    resourceCode: 'tasks',
    actionCode: 'append',
    name: '追加任务',
    description: '目标进入执行后追加新任务，当前用户自审批，审批通过后新任务进入待办',
    icon: 'i-lucide-plus-square',
    embedUrlPattern: '{app_base_url}/projects/{biz_context.project_id}/work-items/{biz_id}/breakdown',
    sortOrder: 30,
    enabled: true
  },
  {
    resourceCode: 'tasks',
    actionCode: 'complete',
    name: '任务完成确认',
    description: '任务执行完成后的确认审批，审批通过后任务进入完成态',
    icon: 'i-lucide-check-check',
    embedUrlPattern: '{app_base_url}/projects/{biz_context.project_id}/board/{biz_id}/execution',
    sortOrder: 40,
    enabled: true
  },
  {
    resourceCode: 'requirements',
    actionCode: 'requirement_baseline',
    name: '需求基线评审',
    description: '项目首次或新增一批需求的基线评审',
    icon: 'i-lucide-clipboard-check',
    embedUrlPattern: '{app_base_url}/projects/{biz_context.project_id}/requirements?tab=review&batchId={biz_id}',
    sortOrder: 10,
    enabled: true
  },
  {
    resourceCode: 'requirements',
    actionCode: 'requirement_change',
    name: '需求变更评审',
    description: '已基线需求的变更评审',
    icon: 'i-lucide-file-pen-line',
    embedUrlPattern: '{app_base_url}/projects/{biz_context.project_id}/requirements?tab=review&batchId={biz_id}',
    sortOrder: 20,
    enabled: true
  },
  {
    resourceCode: 'milestones',
    actionCode: 'milestone_review',
    name: '里程碑评审',
    description: '当前活动里程碑的交付评审；通过后当前里程碑完成并自动激活下一个里程碑',
    icon: 'i-lucide-flag-triangle-right',
    embedUrlPattern: '{app_base_url}/projects/{biz_context.project_id}/milestones/{biz_id}',
    sortOrder: 10,
    enabled: true
  }
]

type RouteAction = 'view' | 'edit' | 'admin'

export interface RoutePermissionRequirement {
  resource: string
  action: RouteAction
}

export interface RouteRule extends RoutePermissionRequirement {
  /**
   * 路由匹配模式（支持 ** 和 * 通配符）
   */
  pattern: string
  /**
   * 任一权限满足即可访问。resource/action 仍保留为主权限，用于日志兼容。
   */
  anyOf?: RoutePermissionRequirement[]
}

/**
 * 路由权限规则
 */
export const routeRules: RouteRule[] = [
  {
    pattern: '/admin/projects',
    resource: 'projects',
    action: 'admin',
    anyOf: [
      { resource: 'projects', action: 'admin' },
      { resource: 'admin', action: 'admin' }
    ]
  },
  {
    pattern: '/admin/projects/**',
    resource: 'projects',
    action: 'admin',
    anyOf: [
      { resource: 'projects', action: 'admin' },
      { resource: 'admin', action: 'admin' }
    ]
  },
  {
    pattern: '/admin/products',
    resource: 'admin',
    action: 'admin',
    anyOf: [
      { resource: 'admin', action: 'admin' },
      { resource: 'projects', action: 'admin' }
    ]
  },
  {
    pattern: '/admin/products/**',
    resource: 'admin',
    action: 'admin',
    anyOf: [
      { resource: 'admin', action: 'admin' },
      { resource: 'projects', action: 'admin' }
    ]
  },
  {
    pattern: '/admin/project-templates',
    resource: 'project_templates',
    action: 'admin',
    anyOf: [
      { resource: 'project_templates', action: 'admin' },
      { resource: 'admin', action: 'admin' }
    ]
  },
  {
    pattern: '/admin/project-templates/**',
    resource: 'project_templates',
    action: 'admin',
    anyOf: [
      { resource: 'project_templates', action: 'admin' },
      { resource: 'admin', action: 'admin' }
    ]
  },
  {
    pattern: '/admin',
    resource: 'admin',
    action: 'admin',
    anyOf: [
      { resource: 'admin', action: 'admin' },
      { resource: 'projects', action: 'admin' },
      { resource: 'project_templates', action: 'admin' }
    ]
  },
  {
    pattern: '/weekly-reports',
    resource: 'reports',
    action: 'view',
    anyOf: [
      { resource: 'reports', action: 'view' },
      { resource: 'projects', action: 'admin' },
      { resource: 'project_templates', action: 'admin' },
      { resource: 'admin', action: 'admin' }
    ]
  },
  { pattern: '/admin/**', resource: 'admin', action: 'admin' }
]

/**
 * 匹配路由规则
 */
export function matchRouteRule(path: string): RouteRule | null {
  const normalizedPath = normalizeRoutePath(path)
  for (const rule of routeRules) {
    if (matchPattern(normalizedPath, normalizeRoutePath(rule.pattern))) {
      return rule
    }
  }
  return null
}

export function routeRuleRequirements(rule: RouteRule): RoutePermissionRequirement[] {
  return rule.anyOf?.length ? rule.anyOf : [{ resource: rule.resource, action: rule.action }]
}

function normalizeRoutePath(path: string): string {
  const normalized = String(path || '/').split('?')[0]?.split('#')[0]?.replace(/\/+$/, '') || '/'
  return normalized === '' ? '/' : normalized
}

function matchPattern(path: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\*\*/g, '___DOUBLE___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLE___/g, '.*')
  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(path)
}
