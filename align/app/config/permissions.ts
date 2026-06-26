/**
 * 权限定义清单（单一数据源）
 * TODO: 创建新模块时，需同步修改 package.json.name、runtimeConfig.public.appCode 和这里的 appCode
 */

// 应用编码 - 必须与 Account 模块中注册的应用编码一致
export const appCode = 'align'

/**
 * 资源定义
 * 每个资源对应一组操作权限（view / edit / admin）
 */
export const resources = [
  {
    code: 'dashboard',
    name: '工作台',
    description: '协同工作台',
    sortOrder: 1
  },
  {
    code: 'admin',
    name: '模块管理',
    description: 'Align 模块管理功能',
    sortOrder: 10
  }
]

/**
 * 菜单定义
 * resource: 关联的资源编码（用于权限过滤）
 * action: 需要的操作权限（默认 view）
 */
export type MenuItem = {
  label?: string
  icon?: string
  to?: string
  target?: string
  resource?: string
  action?: string
  type?: 'link' | 'trigger' | 'label'
  children?: MenuItem[]
  onSelect?: () => void
  [key: string]: unknown
}

export const menus: MenuItem[][] = [[
  {
    label: '工作台',
    icon: 'i-lucide-home',
    to: '/'
  },
  {
    label: '模块管理',
    icon: 'i-lucide-settings',
    to: '/admin',
    resource: 'admin',
    action: 'admin',
    type: 'trigger',
    children: [{
      label: '协同设置',
      icon: 'i-lucide-sliders',
      to: '/admin/settings'
    }]
  }
], [
  {
    label: '技术支持',
    icon: 'i-lucide-message-circle',
    to: 'mailto:admin@wiztek.cn',
    target: '_blank'
  }
]]

/**
 * 路由权限规则
 * pattern: 路由匹配模式（支持 ** 和 * 通配符）
 * resource: 关联的资源编码
 * action: 需要的操作权限
 */
export const routeRules = [
  { pattern: '/admin/**', resource: 'admin', action: 'admin' as const }
]

/**
 * 匹配路由规则
 */
export function matchRouteRule(path: string): typeof routeRules[number] | null {
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
