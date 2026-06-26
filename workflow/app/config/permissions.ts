/**
 * Workflow 权限与菜单配置。
 *
 * 资源权限由 app.manifest.json 导入 Platform 后物化，
 * 这里保留运行时菜单和路由守卫需要的资源编码。
 */

export const appCode = 'workflow'

/**
 * 资源定义
 * 每个资源对应一组操作权限。高风险状态变更使用 approve/reject/delegate/cancel/resubmit
 * 等精确动作，不默认由 edit/admin 隐含。
 */
export const resources = [
  {
    code: 'workflow_workspace',
    name: '工作台',
    description: '待办、已办、我发起的',
    sortOrder: 1
  },
  {
    code: 'flow_schemas',
    name: '流程定义',
    description: '审批流程模板、节点配置和版本治理',
    sortOrder: 30
  },
  {
    code: 'workflow_tasks',
    name: '审批任务',
    description: '我的待办、已办任务和审批处理',
    sortOrder: 10
  },
  {
    code: 'workflow_instances',
    name: '流程实例',
    description: '我发起的流程、实例详情、撤回和重新提交',
    sortOrder: 20
  },
  {
    code: 'form_schemas',
    name: '表单定义',
    description: 'JSON Schema 申请表单定义和预览',
    sortOrder: 40
  },
  {
    code: 'action_defs',
    name: '审批业务',
    description: '业务模块资源动作、发起配置和嵌入视图配置',
    sortOrder: 50
  },
  {
    code: 'route_rules',
    name: '路由规则',
    description: '按部门、角色、表单数据和优先级匹配审批流程',
    sortOrder: 60
  }
]

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
    label: '工作台',
    icon: 'i-lucide-home',
    to: '/'
  },
  {
    label: '我的待办',
    icon: 'i-lucide-inbox',
    to: '/tasks'
  },
  {
    label: '我发起的',
    icon: 'i-lucide-send',
    to: '/instances'
  },
  {
    label: '流程管理',
    icon: 'i-lucide-settings',
    to: '/admin',
    resource: 'flow_schemas',
    action: 'admin',
    type: 'trigger',
    children: [
      {
        label: '流程定义',
        icon: 'i-lucide-git-branch',
        to: '/admin/flows'
      },
      {
        label: '表单定义',
        icon: 'i-lucide-file-text',
        to: '/admin/forms'
      },
      {
        label: '审批业务',
        icon: 'i-lucide-git-pull-request',
        to: '/admin/actions'
      },
      {
        label: '路由规则',
        icon: 'i-lucide-route',
        to: '/admin/routes'
      }
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

/**
 * 路由权限规则
 * pattern: 路由匹配模式（支持 ** 和 * 通配符）
 * resource: 关联的资源编码
 * action: 需要的操作权限
 */
export const routeRules = [
  { pattern: '/admin/**', resource: 'flow_schemas', action: 'admin' as const }
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
