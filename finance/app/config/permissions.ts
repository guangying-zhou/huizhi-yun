export type PermissionAction = 'view' | 'edit' | 'approve' | 'confirm' | 'export' | 'admin'

export interface ResourceDefinition {
  code: string
  name: string
  description: string
  sortOrder: number
  actions: PermissionAction[]
}

export interface MenuItemDefinition {
  [key: string]: unknown
  label: string
  icon?: string
  to?: string
  target?: string
  resource?: string
  action?: PermissionAction
  type?: 'trigger'
  children?: MenuItemDefinition[]
}

export interface RouteRule {
  pattern: string
  resource: string
  action: PermissionAction
}

export const appCode = 'finance'

export const approvalActions = [
  {
    resourceCode: 'invoices',
    actionCode: 'request',
    name: '开票申请审批',
    description: '合同或项目相关开票申请审批，通过后可生成正式发票',
    icon: 'i-lucide-file-check-2',
    embedUrlPattern: '{app_base_url}/invoices/requests',
    sortOrder: 10,
    enabled: true
  },
  {
    resourceCode: 'expenses',
    actionCode: 'claim',
    name: '费用报销审批',
    description: '员工费用报销审批，通过后生成支出台账',
    icon: 'i-lucide-clipboard-list',
    embedUrlPattern: '{app_base_url}/expenses/claims',
    sortOrder: 20,
    enabled: true
  },
  {
    resourceCode: 'expenses',
    actionCode: 'project_expense',
    name: '项目支出审批',
    description: '项目采购、外协和项目费用审批，通过后生成支出台账',
    icon: 'i-lucide-briefcase-business',
    embedUrlPattern: '{app_base_url}/expenses/project-requests',
    sortOrder: 30,
    enabled: true
  },
  {
    resourceCode: 'expenses',
    actionCode: 'payment',
    name: '付款申请审批',
    description: '供应商付款、客户退款、借款和其他付款审批，通过后生成支出台账',
    icon: 'i-lucide-send',
    embedUrlPattern: '{app_base_url}/payments/requests',
    sortOrder: 40,
    enabled: true
  }
]

export const resources: ResourceDefinition[] = [
  { code: 'dashboard', name: '财务工作台', description: '现金流、应收应付、审批和经营财务摘要', actions: ['view', 'export'], sortOrder: 1 },
  { code: 'invoices', name: '发票管理', description: '开票申请、正式发票、发票状态和发票关联', actions: ['view', 'edit', 'approve', 'admin'], sortOrder: 10 },
  { code: 'receipts', name: '收款管理', description: '到账记录、银行流水、收款确认和收款核销', actions: ['view', 'edit', 'confirm', 'admin'], sortOrder: 20 },
  { code: 'expenses', name: '费用支出', description: '项目支出、费用报销、付款申请和支出台账', actions: ['view', 'edit', 'approve', 'confirm', 'admin'], sortOrder: 30 },
  { code: 'bank_accounts', name: '银行账户', description: '账户资料、余额快照和资金账户管理', actions: ['view', 'edit', 'admin'], sortOrder: 40 },
  { code: 'reconciliation', name: '核销管理', description: '发票、收款、合同和回款计划核销', actions: ['view', 'edit', 'confirm', 'admin'], sortOrder: 50 },
  { code: 'project_accounting', name: '项目核算', description: '项目收入、支出、成本、毛利和费用分摊', actions: ['view', 'edit', 'admin'], sortOrder: 60 },
  { code: 'performance', name: '绩效金额快照', description: '财务贡献归因、提成、奖金和绩效金额财务口径', actions: ['view', 'edit', 'admin'], sortOrder: 70 },
  { code: 'reports', name: '财务报表', description: '现金流、收支、利润和经营财务分析', actions: ['view', 'export', 'admin'], sortOrder: 80 },
  { code: 'settings', name: '财务设置', description: '科目、费用类型、审批规则、集成配置和系统参数', actions: ['view', 'edit', 'admin'], sortOrder: 90 }
]

export const menus: MenuItemDefinition[][] = [[
  {
    label: '财务工作台',
    icon: 'i-lucide-layout-dashboard',
    to: '/',
    resource: 'dashboard'
  },
  {
    label: '发票与收款',
    icon: 'i-lucide-receipt-text',
    type: 'trigger',
    children: [
      { label: '发票管理', icon: 'i-lucide-file-check-2', to: '/invoices', resource: 'invoices' },
      { label: '开票申请', icon: 'i-lucide-file-plus-2', to: '/invoices/requests', resource: 'invoices' },
      { label: '收款管理', icon: 'i-lucide-wallet-cards', to: '/receipts', resource: 'receipts' },
      { label: '核销管理', icon: 'i-lucide-list-checks', to: '/reconciliation', resource: 'reconciliation' }
    ]
  },
  {
    label: '费用与付款',
    icon: 'i-lucide-credit-card',
    type: 'trigger',
    children: [
      { label: '费用报销', icon: 'i-lucide-clipboard-list', to: '/expenses/claims', resource: 'expenses' },
      { label: '项目支出', icon: 'i-lucide-briefcase-business', to: '/expenses/projects', resource: 'expenses' },
      { label: '项目支出审批', icon: 'i-lucide-file-clock', to: '/expenses/project-requests', resource: 'expenses' },
      { label: '付款申请', icon: 'i-lucide-send', to: '/payments/requests', resource: 'expenses' }
    ]
  },
  {
    label: '账户与资金',
    icon: 'i-lucide-landmark',
    type: 'trigger',
    children: [
      { label: '银行账户', icon: 'i-lucide-landmark', to: '/bank-accounts', resource: 'bank_accounts' },
      { label: '余额快照', icon: 'i-lucide-badge-dollar-sign', to: '/bank-accounts/balances', resource: 'bank_accounts' },
      { label: '余额变动', icon: 'i-lucide-chart-no-axes-combined', to: '/bank-accounts/balance-changes', resource: 'bank_accounts' }
    ]
  },
  {
    label: '项目核算',
    icon: 'i-lucide-chart-no-axes-combined',
    type: 'trigger',
    children: [
      { label: '项目汇总', icon: 'i-lucide-chart-no-axes-combined', to: '/project-accounting', resource: 'project_accounting' },
      { label: '成本分摊', icon: 'i-lucide-git-branch', to: '/project-accounting/allocations', resource: 'project_accounting' },
      { label: '员工成本', icon: 'i-lucide-users', to: '/project-accounting/employee-costs', resource: 'project_accounting' }
    ]
  },
  {
    label: '个人绩效',
    icon: 'i-lucide-user-check',
    type: 'trigger',
    children: [
      { label: '绩效结果', icon: 'i-lucide-user-check', to: '/performance', resource: 'performance' },
      { label: '贡献记录', icon: 'i-lucide-hand-coins', to: '/performance/contributions', resource: 'performance' },
      { label: '绩效规则', icon: 'i-lucide-sliders-horizontal', to: '/performance/rules', resource: 'performance' },
      { label: '计算快照', icon: 'i-lucide-history', to: '/performance/snapshots', resource: 'performance' }
    ]
  },
  {
    label: '财务报表',
    icon: 'i-lucide-chart-column',
    to: '/reports',
    resource: 'reports'
  },
  {
    label: '财务设置',
    icon: 'i-lucide-settings',
    type: 'trigger',
    resource: 'settings',
    action: 'admin',
    children: [
      { label: '财务科目', icon: 'i-lucide-list-tree', to: '/settings', resource: 'settings', action: 'admin' },
      { label: '核算对象', icon: 'i-lucide-boxes', to: '/accounting-objects', resource: 'settings', action: 'admin' },
      { label: '科目映射', icon: 'i-lucide-route', to: '/settings/subject-mappings', resource: 'settings', action: 'admin' },
      { label: '收入类型', icon: 'i-lucide-trending-up', to: '/settings/income-types', resource: 'settings', action: 'admin' },
      { label: '费用类型', icon: 'i-lucide-trending-down', to: '/settings/expense-types', resource: 'settings', action: 'admin' },
      { label: '人力成本参数', icon: 'i-lucide-calculator', to: '/settings/people-cost-parameters', resource: 'settings', action: 'admin' },
      { label: '审批实例', icon: 'i-lucide-workflow', to: '/settings/approval-instances', resource: 'settings', action: 'admin' },
      { label: '审计日志', icon: 'i-lucide-shield-check', to: '/settings/audit-logs', resource: 'settings', action: 'admin' }
    ]
  }
], [
  {
    label: '技术支持',
    icon: 'i-lucide-message-circle',
    to: 'mailto:admin@wiztek.cn',
    target: '_blank'
  }
]]

export const routeRules: RouteRule[] = [
  { pattern: '/invoices/**', resource: 'invoices', action: 'view' },
  { pattern: '/receipts/**', resource: 'receipts', action: 'view' },
  { pattern: '/reconciliation/**', resource: 'reconciliation', action: 'view' },
  { pattern: '/expenses/**', resource: 'expenses', action: 'view' },
  { pattern: '/payments/**', resource: 'expenses', action: 'view' },
  { pattern: '/bank-accounts/**', resource: 'bank_accounts', action: 'view' },
  { pattern: '/project-accounting/**', resource: 'project_accounting', action: 'view' },
  { pattern: '/performance/**', resource: 'performance', action: 'view' },
  { pattern: '/reports/**', resource: 'reports', action: 'view' },
  { pattern: '/accounting-objects/**', resource: 'settings', action: 'admin' },
  { pattern: '/settings/**', resource: 'settings', action: 'admin' }
]

export function matchRouteRule(path: string): RouteRule | null {
  for (const rule of routeRules) {
    if (matchPattern(path, rule.pattern)) {
      return rule
    }
  }
  return null
}

function matchPattern(path: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\*\*/g, '___DOUBLE___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLE___/g, '.*')
  return new RegExp(`^${regexStr}$`).test(path)
}
