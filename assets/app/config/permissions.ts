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

// 应用编码 - 必须与 Platform app manifest 中注册的应用编码一致
export const appCode = 'assets'

export const approvalActions = [
  {
    resourceCode: 'purchase_orders',
    actionCode: 'purchase_apply',
    name: '资产采购审批',
    description: '实物资产、资源订阅和项目环境投入采购申请审批',
    icon: 'i-lucide-shopping-cart',
    embedUrlPattern: '{app_base_url}/procurement/orders/{biz_id}',
    sortOrder: 10,
    enabled: true
  },
  {
    resourceCode: 'assignments',
    actionCode: 'asset_claim',
    name: '资产领用审批',
    description: '员工或项目领用资产、Seat、额度和资源访问权限审批',
    icon: 'i-lucide-hand',
    embedUrlPattern: '{app_base_url}/operations/assignments',
    sortOrder: 20,
    enabled: true
  },
  {
    resourceCode: 'assignments',
    actionCode: 'asset_assign',
    name: '资产分配审批',
    description: '资产分配、转移到用户、部门、项目或环境前的审批',
    icon: 'i-lucide-arrow-right-left',
    embedUrlPattern: '{app_base_url}/operations/assignments',
    sortOrder: 30,
    enabled: true
  },
  {
    resourceCode: 'assignments',
    actionCode: 'asset_return',
    name: '资产退回审批',
    description: '资产退回、释放、撤销访问权限和密钥轮换审批',
    icon: 'i-lucide-undo-2',
    embedUrlPattern: '{app_base_url}/operations/assignments',
    sortOrder: 40,
    enabled: true
  },
  {
    resourceCode: 'assignments',
    actionCode: 'asset_scrap',
    name: '资产报废审批',
    description: '资产报废、停用和处置审批',
    icon: 'i-lucide-trash-2',
    embedUrlPattern: '{app_base_url}/operations/assignments',
    sortOrder: 50,
    enabled: true
  }
]

export const resources: ResourceDefinition[] = [
  { code: 'dashboard', name: '工作台', description: '工作台与首页看板', actions: ['view'], sortOrder: 1 },
  { code: 'asset_items', name: '资产台账', description: '实物资产与资源资产台账', actions: ['view', 'edit', 'approve', 'admin'], sortOrder: 10 },
  { code: 'products', name: '产品资产', description: '产品主档与产品资产', actions: ['view', 'edit', 'admin'], sortOrder: 15 },
  { code: 'ip_assets', name: '知识产权资产', description: '软著、商标、专利与资质证照', actions: ['view', 'edit', 'admin'], sortOrder: 16 },
  { code: 'digital_assets', name: '数字资产', description: '代码、文档、数据、模型与交付物', actions: ['view', 'edit', 'admin'], sortOrder: 17 },
  { code: 'technology_bases', name: '技术底座', description: '基础平台、中台和共用模块', actions: ['view', 'edit', 'admin'], sortOrder: 18 },
  { code: 'environments', name: '环境视图', description: '环境视图管理', actions: ['view', 'edit', 'admin'], sortOrder: 20 },
  { code: 'deliveries', name: '客户交付视图', description: '客户交付视图管理', actions: ['view', 'edit', 'admin'], sortOrder: 30 },
  { code: 'suppliers', name: '供应商台账', description: '供应商基础台账', actions: ['view', 'edit', 'admin'], sortOrder: 40 },
  { code: 'purchase_orders', name: '采购单', description: '采购申请与采购单管理', actions: ['view', 'edit', 'approve', 'admin'], sortOrder: 50 },
  { code: 'receipts', name: '入库激活', description: '实物入库与资源激活', actions: ['view', 'edit', 'admin'], sortOrder: 60 },
  { code: 'assignments', name: '资产操作', description: '分配、领用、归还、释放等操作', actions: ['view', 'edit', 'approve', 'admin'], sortOrder: 70 },
  { code: 'alerts', name: '预警中心', description: '预警处理与闭环', actions: ['view', 'edit', 'admin'], sortOrder: 80 },
  { code: 'reports', name: '报表统计', description: '报表和成本归因', actions: ['view', 'admin'], sortOrder: 90 },
  { code: 'admin', name: '系统管理', description: '系统管理功能', actions: ['view', 'admin'], sortOrder: 100 }
]

export const menus: MenuItemDefinition[][] = [[
  {
    label: '工作台',
    icon: 'i-lucide-layout-dashboard',
    to: '/',
    resource: 'dashboard'
  },
  {
    label: '资产台账',
    icon: 'i-lucide-boxes',
    type: 'trigger',
    resource: 'asset_items',
    children: [
      {
        label: '实物资产',
        icon: 'i-lucide-laptop',
        to: '/assets/physical',
        resource: 'asset_items'
      },
      {
        label: '产品资产',
        icon: 'i-lucide-box',
        to: '/products',
        resource: 'products'
      },
      {
        label: '知识产权',
        icon: 'i-lucide-badge-check',
        to: '/assets/ip',
        resource: 'ip_assets'
      },
      {
        label: '数字资产',
        icon: 'i-lucide-binary',
        to: '/assets/digital',
        resource: 'digital_assets'
      },
      {
        label: '资源资产',
        icon: 'i-lucide-cloud-cog',
        to: '/assets/resources',
        resource: 'asset_items'
      }
    ]
  },
  {
    label: '资产视图',
    icon: 'i-lucide-network',
    type: 'trigger',
    children: [
      {
        label: '资产总览',
        icon: 'i-lucide-chart-pie',
        to: '/environments',
        resource: 'environments'
      },
      {
        label: '环境视图',
        icon: 'i-lucide-server-cog',
        to: '/environments',
        resource: 'environments'
      },
      {
        label: '客户交付视图',
        icon: 'i-lucide-briefcase-business',
        to: '/deliveries',
        resource: 'deliveries'
      }
    ]
  },
  {
    label: '采购管理',
    icon: 'i-lucide-shopping-cart',
    type: 'trigger',
    children: [
      {
        label: '供应商',
        icon: 'i-lucide-building-2',
        to: '/procurement/suppliers',
        resource: 'suppliers'
      },
      {
        label: '采购单',
        icon: 'i-lucide-file-text',
        to: '/procurement/orders',
        resource: 'purchase_orders'
      },
      {
        label: '入库激活',
        icon: 'i-lucide-package-check',
        to: '/procurement/receipts',
        resource: 'receipts'
      }
    ]
  },
  {
    label: '资产操作',
    icon: 'i-lucide-repeat',
    to: '/operations/assignments',
    resource: 'assignments'
  },
  {
    label: '预警中心',
    icon: 'i-lucide-triangle-alert',
    to: '/alerts',
    resource: 'alerts'
  },
  {
    label: '报表统计',
    icon: 'i-lucide-chart-column',
    to: '/reports',
    resource: 'reports'
  }
], [
  {
    label: '系统管理',
    icon: 'i-lucide-settings',
    type: 'trigger',
    resource: 'admin',
    action: 'admin',
    children: [
      {
        label: '资产类别管理',
        icon: 'i-lucide-list-tree',
        to: '/admin/asset-categories',
        resource: 'admin',
        action: 'admin'
      },
      {
        label: '字典管理',
        icon: 'i-lucide-book-marked',
        to: '/admin/dictionaries',
        resource: 'admin',
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
  { pattern: '/assets/ip', resource: 'ip_assets', action: 'view' },
  { pattern: '/assets/ip/**', resource: 'ip_assets', action: 'view' },
  { pattern: '/ip-assets/**', resource: 'ip_assets', action: 'view' },
  { pattern: '/assets/digital', resource: 'digital_assets', action: 'view' },
  { pattern: '/assets/digital/**', resource: 'digital_assets', action: 'view' },
  { pattern: '/digital-assets/**', resource: 'digital_assets', action: 'view' },
  { pattern: '/assets/products', resource: 'products', action: 'view' },
  { pattern: '/assets/products/**', resource: 'products', action: 'view' },
  { pattern: '/assets/**', resource: 'asset_items', action: 'view' },
  { pattern: '/products', resource: 'products', action: 'view' },
  { pattern: '/products/**', resource: 'products', action: 'view' },
  { pattern: '/technology-bases', resource: 'technology_bases', action: 'view' },
  { pattern: '/technology-bases/**', resource: 'technology_bases', action: 'view' },
  { pattern: '/environments', resource: 'environments', action: 'view' },
  { pattern: '/environments/**', resource: 'environments', action: 'view' },
  { pattern: '/deliveries', resource: 'deliveries', action: 'view' },
  { pattern: '/deliveries/**', resource: 'deliveries', action: 'view' },
  { pattern: '/procurement/suppliers', resource: 'suppliers', action: 'view' },
  { pattern: '/procurement/suppliers/**', resource: 'suppliers', action: 'view' },
  { pattern: '/procurement/orders', resource: 'purchase_orders', action: 'view' },
  { pattern: '/procurement/orders/**', resource: 'purchase_orders', action: 'view' },
  { pattern: '/procurement/receipts', resource: 'receipts', action: 'view' },
  { pattern: '/procurement/receipts/**', resource: 'receipts', action: 'view' },
  { pattern: '/operations/assignments', resource: 'assignments', action: 'view' },
  { pattern: '/operations/assignments/**', resource: 'assignments', action: 'view' },
  { pattern: '/alerts', resource: 'alerts', action: 'view' },
  { pattern: '/alerts/**', resource: 'alerts', action: 'view' },
  { pattern: '/reports', resource: 'reports', action: 'view' },
  { pattern: '/reports/**', resource: 'reports', action: 'view' },
  { pattern: '/admin', resource: 'admin', action: 'admin' },
  { pattern: '/admin/asset-categories', resource: 'admin', action: 'admin' },
  { pattern: '/admin/asset-categories/**', resource: 'admin', action: 'admin' },
  { pattern: '/admin/dictionaries', resource: 'admin', action: 'admin' },
  { pattern: '/admin/dictionaries/**', resource: 'admin', action: 'admin' },
  { pattern: '/admin/**', resource: 'admin', action: 'admin' }
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
