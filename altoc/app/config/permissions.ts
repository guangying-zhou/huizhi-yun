/**
 * 权限定义清单
 * Altoc LTC 经营平台
 */

// 应用编码 - 必须与 Platform app manifest 中注册的应用编码一致
export const appCode = 'altoc'

export const permissionActions = [
  'view',
  'edit',
  'export',
  'assign',
  'disqualify',
  'convert',
  'activity',
  'transition',
  'approve',
  'confirm',
  'mark-billable',
  'finance-summary:sync',
  'delivery-asset-status:sync',
  'delivery-result:sync',
  'close',
  'admin'
] as const

export type PermissionAction = typeof permissionActions[number]

export interface PermissionResource {
  code: string
  name: string
  description: string
  actions: PermissionAction[]
  sortOrder: number
}

/**
 * 资源定义
 * 每个资源对应一组操作权限，需与 app.manifest.json 保持一致。
 */
export const resources: PermissionResource[] = [
  {
    code: 'dashboard',
    name: '经营驾驶舱',
    description: '经营漏斗、回款节奏、经营报表与数据分析视图',
    actions: ['view', 'export'],
    sortOrder: 1
  },
  {
    code: 'customer',
    name: '客户管理',
    description: '客户档案、分级、联系人与客户跟进记录',
    actions: ['view', 'edit', 'approve', 'admin'],
    sortOrder: 10
  },
  {
    code: 'lead',
    name: '线索管理',
    description: '销售线索登记、分配与转化',
    actions: ['view', 'edit', 'assign', 'disqualify', 'convert', 'activity', 'admin'],
    sortOrder: 20
  },
  {
    code: 'opportunity',
    name: '商机管理',
    description: '商机阶段、负责人、预测金额与销售活动',
    actions: ['view', 'edit', 'assign', 'transition', 'activity', 'admin'],
    sortOrder: 30
  },
  {
    code: 'quotation',
    name: '报价管理',
    description: '报价单、报价版本、招投标项目与材料管理',
    actions: ['view', 'edit', 'approve', 'admin'],
    sortOrder: 40
  },
  {
    code: 'contract',
    name: '合同管理',
    description: '合同主数据、里程碑、履约状态和合同文档',
    actions: ['view', 'edit', 'approve', 'finance-summary:sync', 'delivery-asset-status:sync', 'admin'],
    sortOrder: 50
  },
  {
    code: 'receivable',
    name: '回款管理',
    description: '回款计划、回款确认、逾期扫描与发票登记',
    actions: ['view', 'edit', 'confirm', 'mark-billable', 'admin'],
    sortOrder: 60
  },
  {
    code: 'maintenance_contract',
    name: '维保合同',
    description: '维保合同、服务期限、产品版本、客户成功负责人和续约提醒',
    actions: ['view', 'edit', 'admin'],
    sortOrder: 70
  },
  {
    code: 'service_entitlement',
    name: '服务权益',
    description: '服务窗口、SLA 响应时限、解决时限、额度和计费方式',
    actions: ['view', 'edit', 'admin'],
    sortOrder: 71
  },
  {
    code: 'service_ticket',
    name: '服务工单',
    description: '报障、咨询、需求、变更工单入口和跨模块处理引用',
    actions: ['view', 'edit', 'close', 'delivery-result:sync', 'admin'],
    sortOrder: 72
  },
  {
    code: 'renewal_opportunity',
    name: '续约机会',
    description: '维保续约、增购、交叉销售机会和下一步动作',
    actions: ['view', 'edit', 'admin'],
    sortOrder: 73
  },
  {
    code: 'settings',
    name: '经营设置',
    description: '基础配置、团队管理与个人设置',
    actions: ['view', 'edit', 'admin'],
    sortOrder: 90
  },
  {
    code: 'admin',
    name: '系统管理',
    description: '经营模块系统管理、团队和字段配置',
    actions: ['view', 'edit', 'admin'],
    sortOrder: 100
  }
]

/**
 * 菜单定义
 * resource: 关联的资源编码（用于权限过滤）
 * action: 需要的操作权限（默认 view）
 */
export interface MenuItem {
  [key: string]: unknown
  label: string
  icon?: string
  to?: string
  type?: 'trigger' | 'label' | 'separator'
  resource?: string
  action?: PermissionAction
  children?: MenuItem[]
}

export const menus: MenuItem[][] = [[
  {
    label: '首页',
    icon: 'i-lucide-home',
    to: '/'
  },
  {
    label: '销售管理',
    icon: 'i-lucide-users',
    type: 'trigger',
    children: [
      {
        label: '线索',
        icon: 'i-lucide-target',
        to: '/leads',
        resource: 'lead'
      },
      {
        label: '客户',
        icon: 'i-lucide-building-2',
        to: '/customers',
        resource: 'customer'
      },
      {
        label: '商机',
        icon: 'i-lucide-trending-up',
        to: '/opportunities',
        resource: 'opportunity'
      }
    ]
  },
  {
    label: '商务管理',
    icon: 'i-lucide-file-text',
    type: 'trigger',
    children: [
      {
        label: '报价',
        icon: 'i-lucide-calculator',
        to: '/quotes',
        resource: 'quotation'
      },
      {
        label: '投标',
        icon: 'i-lucide-gavel',
        to: '/tenders',
        resource: 'quotation'
      },
      {
        label: '合同',
        icon: 'i-lucide-file-signature',
        to: '/contracts',
        resource: 'contract'
      },
      {
        label: '回款',
        icon: 'i-lucide-wallet',
        to: '/payments',
        resource: 'receivable'
      }
    ]
  },
  {
    label: '数据分析',
    icon: 'i-lucide-bar-chart-3',
    type: 'trigger',
    children: [
      {
        label: '经营看板',
        icon: 'i-lucide-layout-dashboard',
        to: '/dashboard',
        resource: 'dashboard'
      }
    ]
  }
], [
  {
    label: '设置',
    icon: 'i-lucide-settings',
    to: '/settings',
    resource: 'settings',
    type: 'trigger',
    children: [
      {
        label: '基础配置',
        icon: 'i-lucide-sliders',
        to: '/settings'
      },
      {
        label: '团队管理',
        icon: 'i-lucide-users',
        to: '/settings/teams'
      },
      {
        label: '个人设置',
        icon: 'i-lucide-user-cog',
        to: '/settings/profile'
      }
    ]
  }
]]

/**
 * 路由权限规则
 * pattern: 路由匹配模式（支持 ** 和 * 通配符）
 * resource: 关联的资源编码
 * action: 需要的操作权限
 */
export interface RouteRule {
  pattern: string
  resource: string
  action: PermissionAction
}

export const routeRules: RouteRule[] = [
  { pattern: '/customers/**', resource: 'customer', action: 'view' },
  { pattern: '/leads/**', resource: 'lead', action: 'view' },
  { pattern: '/opportunities/**', resource: 'opportunity', action: 'view' },
  { pattern: '/quotes/**', resource: 'quotation', action: 'view' },
  { pattern: '/tenders/**', resource: 'quotation', action: 'view' },
  { pattern: '/contracts/**', resource: 'contract', action: 'view' },
  { pattern: '/payments/**', resource: 'receivable', action: 'view' },
  { pattern: '/dashboard/**', resource: 'dashboard', action: 'view' },
  { pattern: '/settings/**', resource: 'settings', action: 'view' },
  { pattern: '/admin/**', resource: 'admin', action: 'admin' }
]

/**
 * 审批动作定义
 * 启动时由 server/plugins/sync-approval-actions.ts 同步到 Workflow 服务
 */
export const approvalActions = [
  {
    resourceCode: 'customer',
    actionCode: 'approve',
    name: '新增客户审批',
    description: '新建客户提交审批，审核客户信息与合作资质',
    icon: 'i-lucide-building-2',
    embedUrlPattern: '{app_base_url}/customers/{biz_id}',
    sortOrder: 5,
    enabled: true
  },
  {
    resourceCode: 'quotation',
    actionCode: 'approve',
    name: '报价审批',
    description: '报价单提交审批，审核金额、折扣和交付条款',
    icon: 'i-lucide-file-check',
    embedUrlPattern: '{app_base_url}/quotes/{biz_id}',
    sortOrder: 10,
    enabled: true
  },
  {
    resourceCode: 'contract',
    actionCode: 'approve',
    name: '合同审批',
    description: '合同签署前审批，审核条款、金额和客户资质',
    icon: 'i-lucide-file-signature',
    embedUrlPattern: '{app_base_url}/contracts/{biz_id}',
    sortOrder: 20,
    enabled: true
  }
]

/**
 * 匹配路由规则
 */
export function matchRouteRule(path: string): RouteRule | null {
  for (const rule of routeRules) {
    if (matchPattern(path, rule.pattern)) {
      return rule
    }
  }
  return null
}

function matchPattern(path: string, pattern: string): boolean {
  const normalizedPath = path.length > 1 ? path.replace(/\/+$/, '') : path
  const normalizedPattern = pattern.length > 1 ? pattern.replace(/\/+$/, '') : pattern
  if (normalizedPattern.endsWith('/**') && normalizedPath === normalizedPattern.slice(0, -3)) {
    return true
  }

  const regexStr = pattern
    .replace(/\*\*/g, '___DOUBLE___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLE___/g, '.*')
  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(normalizedPath)
}
