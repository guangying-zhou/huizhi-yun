/**
 * 权限定义清单（单一数据源）
 * Console 权限定义清单。
 */

import appManifestJson from '../../app.manifest.json'

export const appManifest = appManifestJson

// 应用编码 - 必须与平台 manifest 和 Account 模块中注册的应用编码一致
export const appCode = appManifest.appCode
export const manifestResources = appManifest.resources

/**
 * 资源定义
 * 每个资源对应一组操作权限（view / edit / admin）
 */
export const resources = manifestResources.map(resource => ({
  code: resource.code,
  name: resource.name,
  description: resource.description,
  sortOrder: resource.sortOrder
}))

/**
 * 菜单定义
 * resource: 关联的资源编码（用于权限过滤）
 * action: 需要的操作权限（默认 view）
 */
interface MenuItem {
  label: string
  icon?: string
  to?: string
  target?: string
  resource?: string
  action?: 'view' | 'edit' | 'admin'
  type?: string
  children?: MenuItem[]
  [key: string]: unknown
}

export const menus: MenuItem[][] = [[
  {
    label: '管理概览',
    icon: 'i-lucide-layout-dashboard',
    to: '/admin',
    resource: 'console_overview'
  },
  {
    label: '企业资料',
    icon: 'i-lucide-building-2',
    to: '/org-profile',
    resource: 'org_profile'
  },
  {
    label: '目录管理',
    icon: 'i-lucide-network',
    children: [
      {
        label: '部门',
        icon: 'i-lucide-git-fork',
        to: '/directory/departments',
        resource: 'directory_departments'
      },
      {
        label: '用户',
        icon: 'i-lucide-users-round',
        to: '/directory/users',
        resource: 'directory_users'
      },
      {
        label: '代码仓库',
        icon: 'i-simple-icons-gitlab',
        to: '/directory/projects',
        resource: 'directory_projects'
      },
      {
        label: '目录源配置',
        icon: 'i-lucide-plug',
        to: '/directory/sources',
        resource: 'directory_sources'
      },
      {
        label: '目录同步',
        icon: 'i-lucide-refresh-cw',
        to: '/directory/sync',
        resource: 'directory_sync'
      }
    ]
  },
  {
    label: '系统参数',
    icon: 'i-lucide-sliders-horizontal',
    to: '/system-settings',
    resource: 'system_settings'
  },
  {
    label: '节假日管理',
    icon: 'i-lucide-calendar-days',
    to: '/work-calendar',
    resource: 'system_settings'
  },
  {
    label: '集成中心',
    icon: 'i-lucide-plug',
    to: '/integrations',
    resource: 'integration_config'
  },
  {
    label: '运行时管理',
    icon: 'i-lucide-server-cog',
    children: [
      {
        label: '数据运行时',
        icon: 'i-lucide-database-zap',
        to: '/data-runtime',
        resource: 'system_settings'
      },
      {
        label: '通知运行时',
        icon: 'i-lucide-send',
        to: '/notification-runtime',
        resource: 'system_settings'
      }
    ]
  },
  {
    label: '凭证库',
    icon: 'i-lucide-key-round',
    to: '/vault',
    resource: 'credential_vault'
  },
  {
    label: '服务凭证',
    icon: 'i-lucide-shield-check',
    to: '/service-clients',
    resource: 'service_clients'
  }
], [
  {
    label: '系统管理',
    icon: 'i-lucide-settings-2',
    children: [
      {
        label: '日志管理',
        icon: 'i-lucide-scroll-text',
        to: '/admin/logs',
        resource: 'system_settings'
      },
      {
        label: '业务领域',
        icon: 'i-lucide-grid-2x2',
        to: '/admin/business-domains',
        resource: 'org_profile'
      },
      {
        label: '区域管理',
        icon: 'i-lucide-map',
        to: '/admin/regions',
        resource: 'org_profile'
      },
      {
        label: '应用运行管理',
        icon: 'i-lucide-server-cog',
        to: '/admin/runtime-apps',
        resource: 'system_settings',
        action: 'admin'
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
export const routeRules = [
  { pattern: '/admin', resource: 'console_overview', action: 'view' as const },
  { pattern: '/admin/logs', resource: 'system_settings', action: 'view' as const },
  { pattern: '/admin/business-domains', resource: 'org_profile', action: 'view' as const },
  { pattern: '/admin/regions', resource: 'org_profile', action: 'view' as const },
  { pattern: '/admin/runtime-apps', resource: 'system_settings', action: 'admin' as const },
  { pattern: '/admin/**', resource: 'console_overview', action: 'view' as const },
  { pattern: '/org-profile', resource: 'org_profile', action: 'view' as const },
  { pattern: '/org-profile/**', resource: 'org_profile', action: 'view' as const },
  { pattern: '/directory/users', resource: 'directory_users', action: 'view' as const },
  { pattern: '/directory/users/**', resource: 'directory_users', action: 'view' as const },
  { pattern: '/directory/departments', resource: 'directory_departments', action: 'view' as const },
  { pattern: '/directory/departments/**', resource: 'directory_departments', action: 'view' as const },
  { pattern: '/directory/projects', resource: 'directory_projects', action: 'view' as const },
  { pattern: '/directory/projects/**', resource: 'directory_projects', action: 'view' as const },
  { pattern: '/directory/sources', resource: 'directory_sources', action: 'view' as const },
  { pattern: '/directory/sources/**', resource: 'directory_sources', action: 'view' as const },
  { pattern: '/directory/sync', resource: 'directory_sync', action: 'view' as const },
  { pattern: '/directory/sync/**', resource: 'directory_sync', action: 'view' as const },
  { pattern: '/system-settings', resource: 'system_settings', action: 'view' as const },
  { pattern: '/system-settings/**', resource: 'system_settings', action: 'view' as const },
  { pattern: '/work-calendar', resource: 'system_settings', action: 'view' as const },
  { pattern: '/work-calendar/**', resource: 'system_settings', action: 'view' as const },
  { pattern: '/integrations', resource: 'integration_config', action: 'view' as const },
  { pattern: '/integrations/**', resource: 'integration_config', action: 'view' as const },
  { pattern: '/data-runtime', resource: 'system_settings', action: 'view' as const },
  { pattern: '/data-runtime/**', resource: 'system_settings', action: 'view' as const },
  { pattern: '/notification-runtime', resource: 'system_settings', action: 'view' as const },
  { pattern: '/notification-runtime/**', resource: 'system_settings', action: 'view' as const },
  { pattern: '/vault', resource: 'credential_vault', action: 'view' as const },
  { pattern: '/vault/**', resource: 'credential_vault', action: 'view' as const },
  { pattern: '/service-clients', resource: 'service_clients', action: 'view' as const },
  { pattern: '/service-clients/**', resource: 'service_clients', action: 'view' as const }
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
