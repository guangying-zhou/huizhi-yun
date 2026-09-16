/**
 * Account 权限清单 (Manifest)
 *
 * 单一数据源：
 * 1. 应用启动时同步资源定义到自身数据库
 * 2. 运行时菜单过滤、路由守卫、操作控制
 *
 * 权限模型：
 * - 每个资源有三级操作：view / edit / admin
 * - 菜单默认要求 view 权限即可显示，可通过 requiredAction 提高要求
 * - 子菜单继承父级 resource，也可覆盖指定自己的 resource
 * - 路由规则按 pattern 匹配，决定页面访问所需权限
 */

export const appCode = 'account'

// ============================================================
// 资源定义（同步到自身 resources 表）
// ============================================================
export const resources = [
  { code: 'profile', name: '个人信息', description: '个人资料、密码、应用', sortOrder: 1 },
  { code: 'admin', name: '系统管理', description: '部门/用户/应用/资源/角色/项目/API/日志管理', sortOrder: 2 }
]

// ============================================================
// 菜单定义
// ============================================================
export interface MenuItem extends Record<string, unknown> {
  label: string
  icon?: string
  to?: string
  target?: string
  resource?: string
  requiredAction?: 'view' | 'edit' | 'admin'
  defaultOpen?: boolean
  type?: 'link' | 'label' | 'trigger'
  disabled?: boolean
  children?: MenuItem[]
  onSelect?: () => void
}

export const menus: MenuItem[][] = [[
  {
    label: '个人信息',
    icon: 'i-lucide-user',
    to: '/profile',
    resource: 'profile'
  },
  {
    label: '我的应用',
    icon: 'i-lucide-table-properties',
    to: '/myapps',
    resource: 'profile'
  },
  {
    label: '账号密码',
    icon: 'i-lucide-eye',
    to: '/password',
    resource: 'profile'
  },
  {
    label: '系统管理',
    icon: 'i-lucide-settings',
    defaultOpen: true,
    type: 'trigger',
    resource: 'admin',
    requiredAction: 'admin',
    children: [
      { label: '部门管理', icon: 'i-lucide-building', to: '/admin/departments' },
      { label: '用户管理', icon: 'i-lucide-users', to: '/admin/users' },
      { label: '应用管理', icon: 'i-lucide-grip', to: '/admin/apps' },
      { label: '资源管理', icon: 'i-lucide-boxes', to: '/admin/resources' },
      { label: '角色管理', icon: 'i-lucide-square-user-round', to: '/admin/roles' },
      { label: '代码库管理', icon: 'i-lucide-folder-kanban', to: '/admin/git-projects' },
      { label: 'API管理', icon: 'i-lucide-webhook', to: '/admin/apis' },
      { label: '钉钉管理', icon: 'i-lucide-message-square-dot', to: '/admin/dingtalk' },
      { label: '日志管理', icon: 'i-lucide-scroll-text', to: '/admin/logs' },
      { label: '公司设置', icon: 'i-lucide-building-2', to: '/admin/company' },
      { label: '业务领域', icon: 'i-lucide-grid-2x2', to: '/admin/business-domains' },
      { label: '区域管理', icon: 'i-lucide-map', to: '/admin/regions' }
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

// ============================================================
// 路由权限规则（中间件使用）
// ============================================================
export interface RouteRule {
  pattern: string
  resource: string
  requiredAction?: 'view' | 'edit' | 'admin'
}

export const routeRules: RouteRule[] = [
  // 系统管理 - 需要 admin 权限
  { pattern: '/admin/**', resource: 'admin', requiredAction: 'admin' },

  // 个人页面 - view 即可
  { pattern: '/profile', resource: 'profile' },
  { pattern: '/password', resource: 'profile' },
  { pattern: '/myapps', resource: 'profile' }
]

// ============================================================
// 工具函数
// ============================================================

export function matchRouteRule(path: string): RouteRule | null {
  for (const rule of routeRules) {
    if (matchPattern(rule.pattern, path)) {
      return rule
    }
  }
  return null
}

function matchPattern(pattern: string, path: string): boolean {
  if (pattern === path) return true

  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3)
    return path === prefix || path.startsWith(prefix + '/')
  }

  if (pattern.includes('*')) {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '[^/]+') + '$'
    )
    return regex.test(path)
  }

  return false
}
