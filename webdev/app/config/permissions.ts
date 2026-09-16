export const appCode = 'webdev'

export const resources = [
  {
    code: 'webdev_workspace',
    name: '开发控制台',
    description: '查看 Dev Agent 状态、触发 Codex 任务、读取任务日志和历史记录',
    sortOrder: 1
  }
]

export const menus = [[
  {
    label: '总览',
    icon: 'i-lucide-layout-dashboard',
    to: '/overview',
    resource: 'webdev_workspace',
    action: 'view' as const
  },
  {
    label: '任务',
    icon: 'i-lucide-square-terminal',
    to: '/',
    resource: 'webdev_workspace',
    action: 'execute' as const
  },
  {
    label: 'Issue 收件箱',
    icon: 'i-lucide-inbox',
    to: '/issues',
    resource: 'webdev_workspace',
    action: 'execute' as const
  },
  {
    label: 'Diff 审查',
    icon: 'i-lucide-git-pull-request-arrow',
    to: '/review',
    resource: 'webdev_workspace',
    action: 'execute' as const
  },
  {
    label: '部署',
    icon: 'i-lucide-rocket',
    to: '/deploy',
    resource: 'webdev_workspace',
    action: 'deploy' as const
  },
  {
    label: 'Agent',
    icon: 'i-lucide-server',
    to: '/agents',
    resource: 'webdev_workspace',
    action: 'admin' as const
  },
  {
    label: '历史',
    icon: 'i-lucide-history',
    to: '/history',
    resource: 'webdev_workspace',
    action: 'view' as const
  }
]]

export const routeRules = [
  { pattern: '/deploy', resource: 'webdev_workspace', action: 'deploy' as const },
  { pattern: '/agents', resource: 'webdev_workspace', action: 'admin' as const },
  { pattern: '/issues', resource: 'webdev_workspace', action: 'execute' as const },
  { pattern: '/review', resource: 'webdev_workspace', action: 'execute' as const },
  { pattern: '/history', resource: 'webdev_workspace', action: 'view' as const },
  { pattern: '/overview', resource: 'webdev_workspace', action: 'view' as const },
  { pattern: '/**', resource: 'webdev_workspace', action: 'execute' as const }
]

export function matchRouteRule(path: string): typeof routeRules[number] | null {
  if (path === '/login' || path.startsWith('/api/')) return null

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
