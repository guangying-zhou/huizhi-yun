export type PermissionAction = 'view' | 'edit' | 'approve' | 'admin'

export interface ResourceDefinition {
  code: string
  name: string
  description: string
  actions: PermissionAction[]
  sortOrder: number
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

export const appCode = 'people'

export const approvalActions = [
  {
    resourceCode: 'assignments',
    actionCode: 'employee_onboard',
    name: '员工入职确认',
    description: '员工基础事实、初始岗位和成本口径确认',
    icon: 'i-lucide-user-plus',
    embedUrlPattern: '{app_base_url}/employees/{biz_id}',
    sortOrder: 10,
    enabled: true
  },
  {
    resourceCode: 'assignments',
    actionCode: 'employee_transfer',
    name: '任职变更审批',
    description: '部门、岗位、职级、直属负责人和成本归属变更审批',
    icon: 'i-lucide-arrow-left-right',
    embedUrlPattern: '{app_base_url}/assignments',
    sortOrder: 20,
    enabled: true
  },
  {
    resourceCode: 'cost_snapshots',
    actionCode: 'employee_cost_adjust',
    name: '人员成本调整',
    description: '月度标准成本、实际成本和财务调整口径确认',
    icon: 'i-lucide-wallet-cards',
    embedUrlPattern: '{app_base_url}/cost-snapshots',
    sortOrder: 30,
    enabled: true
  },
  {
    resourceCode: 'performance_cycles',
    actionCode: 'performance_cycle_confirm',
    name: '绩效周期确认',
    description: '项目贡献快照、绩效周期结果和确认状态审批',
    icon: 'i-lucide-badge-check',
    embedUrlPattern: '{app_base_url}/performance-cycles/{biz_id}',
    sortOrder: 40,
    enabled: true
  }
]

export const resources: ResourceDefinition[] = [
  { code: 'dashboard', name: '工作台', description: '人员运营工作台与指标摘要', actions: ['view'], sortOrder: 1 },
  { code: 'employees', name: '员工', description: '员工事实、任职和成本摘要', actions: ['view', 'edit', 'admin'], sortOrder: 10 },
  { code: 'assignments', name: '任职变更', description: '入转调离和任职快照', actions: ['view', 'edit', 'approve', 'admin'], sortOrder: 20 },
  { code: 'cost_snapshots', name: '成本快照', description: '月度标准成本和实际成本快照', actions: ['view', 'edit', 'approve', 'admin'], sortOrder: 30 },
  { code: 'performance_cycles', name: '绩效周期', description: '项目/季度/年度绩效周期与贡献快照', actions: ['view', 'edit', 'approve', 'admin'], sortOrder: 40 },
  { code: 'standard_costs', name: '职级设置', description: 'M/P 职级工资、绩效工资范围和标准成本口径', actions: ['view', 'edit', 'approve', 'admin'], sortOrder: 70 },
  { code: 'positions', name: '岗位字典', description: '岗位主数据', actions: ['view', 'admin'], sortOrder: 80 },
  { code: 'ranks', name: '职级字典', description: '职级主数据', actions: ['view', 'admin'], sortOrder: 90 },
  { code: 'admin', name: '设置', description: 'People 设置和字典维护', actions: ['view', 'admin'], sortOrder: 100 }
]

export const menus: MenuItemDefinition[][] = [[
  {
    label: '工作台',
    icon: 'i-lucide-layout-dashboard',
    to: '/',
    resource: 'dashboard'
  },
  {
    label: '员工',
    icon: 'i-lucide-users',
    to: '/employees',
    resource: 'employees'
  },
  {
    label: '任职变更',
    icon: 'i-lucide-arrow-left-right',
    to: '/assignments',
    resource: 'assignments'
  },
  {
    label: '职级设置',
    icon: 'i-lucide-calculator',
    to: '/settings/standard-costs',
    resource: 'standard_costs',
    action: 'admin'
  },
  {
    label: '成本快照',
    icon: 'i-lucide-wallet-cards',
    to: '/cost-snapshots',
    resource: 'cost_snapshots'
  },
  {
    label: '绩效周期',
    icon: 'i-lucide-target',
    to: '/performance-cycles',
    resource: 'performance_cycles'
  }
], [
  {
    label: '设置',
    icon: 'i-lucide-settings',
    type: 'trigger',
    resource: 'admin',
    action: 'admin',
    children: [
      {
        label: '岗位字典',
        icon: 'i-lucide-briefcase-business',
        to: '/settings/positions',
        resource: 'positions',
        action: 'admin'
      },
      {
        label: '职级字典',
        icon: 'i-lucide-layers-3',
        to: '/settings/ranks',
        resource: 'ranks',
        action: 'admin'
      }
    ]
  },
  {
    label: '技术支持',
    icon: 'i-lucide-message-circle',
    to: 'mailto:admin@wiztek.cn',
    target: '_blank'
  }
]]

export const routeRules: RouteRule[] = [
  { pattern: '/', resource: 'dashboard', action: 'view' },
  { pattern: '/employees', resource: 'employees', action: 'view' },
  { pattern: '/employees/**', resource: 'employees', action: 'view' },
  { pattern: '/assignments', resource: 'assignments', action: 'view' },
  { pattern: '/assignments/**', resource: 'assignments', action: 'view' },
  { pattern: '/cost-snapshots', resource: 'cost_snapshots', action: 'view' },
  { pattern: '/cost-snapshots/**', resource: 'cost_snapshots', action: 'view' },
  { pattern: '/performance-cycles', resource: 'performance_cycles', action: 'view' },
  { pattern: '/performance-cycles/**', resource: 'performance_cycles', action: 'view' },
  { pattern: '/settings', resource: 'admin', action: 'admin' },
  { pattern: '/settings/standard-costs', resource: 'standard_costs', action: 'view' },
  { pattern: '/settings/standard-costs/**', resource: 'standard_costs', action: 'view' },
  { pattern: '/settings/positions', resource: 'positions', action: 'admin' },
  { pattern: '/settings/positions/**', resource: 'positions', action: 'admin' },
  { pattern: '/settings/ranks', resource: 'ranks', action: 'admin' },
  { pattern: '/settings/ranks/**', resource: 'ranks', action: 'admin' },
  { pattern: '/settings/**', resource: 'admin', action: 'admin' }
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
  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(path)
}
