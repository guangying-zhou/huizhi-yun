/**
 * Codocs 权限清单 (Manifest)
 *
 * 单一数据源：
 * 1. 应用启动时同步资源定义到 Account
 * 2. 运行时菜单过滤、路由守卫、操作控制
 *
 * 权限模型：
 * - 基础操作为 view / edit / admin，高风险和业务动作独立声明
 * - 菜单默认要求 view 权限即可显示，可通过 requiredAction 提高要求
 * - 子菜单继承父级 resource，也可覆盖指定自己的 resource
 * - 路由规则按 pattern 匹配，决定页面访问所需权限
 */

export const appCode = 'codocs'

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'publish' | 'submit' | 'approve' | 'archive' | 'export' | 'admin'

export const approvalActions = [
  {
    resourceCode: 'documents',
    actionCode: 'publish',
    name: '文档发布审批',
    description: 'Codocs 文档发文、对外发文与发布归档审批',
    icon: 'i-lucide-send',
    embedUrlPattern: '{app_base_url}/embed/reviews/{biz_id}',
    sortOrder: 10,
    enabled: true
  }
]

// ============================================================
// 资源定义（同步到 Account 的 resources 表）
// ============================================================
export const resources = [
  {
    code: 'documents',
    name: '文档管理',
    description: '个人文档、收藏、共享、回收站',
    actions: ['view', 'create', 'edit', 'delete', 'export', 'admin'] satisfies PermissionAction[],
    sortOrder: 1
  },
  {
    code: 'info',
    name: '资讯中心',
    description: '前沿资讯、推荐文章',
    actions: ['view', 'edit', 'admin'] satisfies PermissionAction[],
    sortOrder: 2
  },
  {
    code: 'projects',
    name: '项目文档',
    description: '项目组文档、代码库文档、需求与Bug',
    actions: ['view', 'create', 'edit', 'admin'] satisfies PermissionAction[],
    sortOrder: 3
  },
  {
    code: 'departments',
    name: '部门文档',
    description: '协同文档、会议记录、部门知识库',
    actions: ['view', 'create', 'edit', 'export', 'admin'] satisfies PermissionAction[],
    sortOrder: 4
  },
  {
    code: 'company',
    name: '发布文档',
    description: '对外发文、公司规章、技术规范、产品文档、知识库',
    actions: ['view', 'create', 'edit', 'publish', 'admin'] satisfies PermissionAction[],
    sortOrder: 5
  },
  {
    code: 'reviews',
    name: '审阅中心',
    description: '文档审阅、审批流程、归档管理',
    actions: ['view', 'submit', 'approve', 'archive', 'admin'] satisfies PermissionAction[],
    sortOrder: 6
  },
  {
    code: 'admin',
    name: '系统管理',
    description: '发文流程、模板管理、系统设置、资讯管理',
    actions: ['view', 'admin'] satisfies PermissionAction[],
    sortOrder: 7
  }
]

// ============================================================
// 菜单定义（替代 default.vue 中的 rawLinks）
// ============================================================
export interface MenuItem {
  label: string
  icon?: string
  to?: string
  target?: string
  resource?: string // 绑定的资源编码
  requiredAction?: PermissionAction // 默认 view
  defaultOpen?: boolean
  type?: string
  disabled?: boolean
  children?: MenuItem[]
}

export const menus: MenuItem[][] = [
  [
    {
      label: '文档中心',
      icon: 'i-lucide-files',
      to: '/',
      resource: 'documents'
    },
    {
      label: '个人文档',
      icon: 'i-lucide-layout-dashboard',
      defaultOpen: false,
      type: 'trigger',
      resource: 'documents',
      children: [
        { label: '我的文档', icon: 'i-lucide-folder', to: '/mydocs' },
        {
          label: '日志周报',
          icon: 'i-lucide-notebook-pen',
          to: '/mydocs/journal'
        },
        { label: '协同文档', icon: 'i-lucide-share-2', to: '/mydocs/shared' },
        {
          label: '演示文稿',
          icon: 'i-lucide-presentation',
          to: '/mydocs/slides'
        },
        { label: '文件柜', icon: 'i-lucide-archive', to: '/mydocs/cabinet' },
        { label: '收藏夹', icon: 'i-lucide-star', to: '/mydocs/favorites' },
        { label: '回收站', icon: 'i-lucide-trash-2', to: '/mydocs/recycle' }
      ]
    },
    {
      label: '项目文档',
      icon: 'i-lucide-folder-kanban',
      defaultOpen: false,
      type: 'trigger',
      resource: 'projects',
      children: [
        {
          label: '项目组文档',
          icon: 'i-lucide-squares-exclude',
          to: '/projects'
        },
        {
          label: '代码库文档',
          icon: 'i-lucide-file-code-corner',
          to: '/projects/repos'
        }
      ]
    },
    {
      label: '部门文档',
      icon: 'i-lucide-table-properties',
      defaultOpen: false,
      type: 'trigger',
      resource: 'departments',
      children: [
        {
          label: '协同文档',
          icon: 'i-lucide-squares-exclude',
          to: '/departments'
        },
        {
          label: '日志周报',
          icon: 'i-lucide-calendar-range',
          to: '/departments/weekly-reports'
        },
        {
          label: '会议记录',
          icon: 'i-lucide-folder-git-2',
          to: '/departments/records'
        },
        {
          label: '对外发文',
          icon: 'i-lucide-file-output',
          to: '/departments/outsides'
        },
        {
          label: '部门规章',
          icon: 'i-lucide-pencil-ruler',
          to: '/departments/rules'
        },
        {
          label: '文件柜',
          icon: 'i-lucide-archive',
          to: '/departments/cabinet'
        }
      ]
    },
    {
      label: '组织资产',
      icon: 'i-lucide-globe',
      defaultOpen: false,
      type: 'trigger',
      resource: 'company',
      children: [
        { label: '公司制度', icon: 'i-lucide-landmark', to: '/company/rules' },
        {
          label: '通知公告',
          icon: 'i-lucide-megaphone',
          to: '/company/notice'
        },
        { label: '法务合规', icon: 'i-lucide-scale', to: '/company/legal' },
        { label: '企业文化', icon: 'i-lucide-heart', to: '/company/culture' },
        { label: '技术规范', icon: 'i-lucide-code', to: '/company/tech-specs' },
        { label: '产品资料', icon: 'i-lucide-package', to: '/products' },
        {
          label: '公司知识库',
          icon: 'i-lucide-library',
          to: '/company/knowledge'
        },
        {
          label: '文档模板',
          icon: 'i-lucide-file-type',
          to: '/company/templates'
        }
      ]
    },
    {
      label: '资讯中心',
      icon: 'i-lucide-newspaper',
      defaultOpen: false,
      type: 'trigger',
      resource: 'info',
      children: [
        { label: '前沿资讯', icon: 'i-lucide-lightbulb', to: '/info/news' },
        {
          label: '推荐文章',
          icon: 'i-lucide-file-code-corner',
          to: '/info/articles'
        }
      ]
    }
  ],
  [
    {
      label: '系统管理',
      icon: 'i-lucide-settings',
      defaultOpen: false,
      type: 'trigger',
      resource: 'admin',
      requiredAction: 'admin',
      children: [
        { label: '发文流程', icon: 'i-lucide-combine', to: '/admin/publish' },
        {
          label: '模板管理',
          icon: 'i-lucide-layout-template',
          to: '/admin/templates'
        },
        {
          label: '管理资讯书签',
          icon: 'i-lucide-bookmark',
          to: '/info/management'
        },
        { label: '归档文档', icon: 'i-lucide-archive', to: '/admin/archive' },
        { label: '图片清理', icon: 'i-lucide-image-minus', to: '/admin/images' }
      ]
    },
    {
      label: '使用指南',
      icon: 'i-lucide-compass',
      children: [
        {
          label: 'Markdown教程',
          icon: 'i-lucide-book-open-text',
          to: 'https://markdown.com.cn/intro.html',
          target: '_blank'
        },
        {
          label: 'Mermaid语法',
          icon: 'i-lucide-file-chart-column',
          to: 'https://www.wolai.com/wolai/n3iu4CP33sGdxiK91TBADJ',
          target: '_blank'
        }
      ]
    }
  ]
]

// ============================================================
// 路由权限规则（中间件使用）
// 按 pattern 从上到下匹配，首个匹配的规则生效
// requiredAction 默认为 'view'
// ============================================================
export interface RouteRule {
  pattern: string // 路径匹配模式，支持 ** 通配
  resource: string // 资源编码
  requiredAction?: PermissionAction
}

export const routeRules: RouteRule[] = [
  // 系统管理 - 需要 admin 权限
  { pattern: '/admin/**', resource: 'admin', requiredAction: 'admin' },
  { pattern: '/info/management', resource: 'admin', requiredAction: 'admin' },

  // 各功能模块 - view 即可
  { pattern: '/mydocs/**', resource: 'documents' },
  { pattern: '/trash', resource: 'documents' },
  { pattern: '/documents/**', resource: 'documents' },
  { pattern: '/projects/**', resource: 'projects' },
  { pattern: '/departments/**', resource: 'departments' },
  { pattern: '/company/**', resource: 'company' },
  { pattern: '/products/**', resource: 'company' },
  { pattern: '/info/**', resource: 'info' },
  { pattern: '/reviews/**', resource: 'reviews' }
]

// ============================================================
// 工具函数
// ============================================================

/**
 * 匹配路由路径到权限规则
 * 返回匹配的规则，或 null（无需权限控制的页面）
 */
export function matchRouteRule(path: string): RouteRule | null {
  for (const rule of routeRules) {
    if (matchPattern(rule.pattern, path)) {
      return rule
    }
  }
  return null
}

/**
 * 简单的路径模式匹配
 * 支持 ** 匹配任意路径段，* 匹配单个路径段
 */
function matchPattern(pattern: string, path: string): boolean {
  // 精确匹配
  if (pattern === path) return true

  // ** 通配符：匹配任意后续路径
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3)
    return path === prefix || path.startsWith(prefix + '/')
  }

  // * 通配符：匹配单段
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '[^/]+') + '$')
    return regex.test(path)
  }

  return false
}
