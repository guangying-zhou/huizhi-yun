// ============================================================
// 全局视图菜单
// ============================================================

export const globalMenuItems = [
  { label: '工作台', icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: '项目总览', icon: 'i-lucide-blocks', to: '/projects' },
  { label: '项目日历', icon: 'i-lucide-calendar-days', to: '/timesheet' },
  { label: '项目文档', icon: 'i-lucide-files', to: '/project-documents' },
  {
    label: '统计分析',
    icon: 'i-lucide-chart-column',
    children: [
      { label: '周报汇总', icon: 'i-lucide-table', to: '/weekly-reports' },
      { label: '项目资源', icon: 'i-lucide-waypoints', to: '/project-resources' }
    ]
  }
]

export const workItemFilterItems = [
  { label: '我负责的', icon: 'i-lucide-user-check', to: '/work-items?filter=assigned' },
  { label: '我参与的', icon: 'i-lucide-users', to: '/work-items?filter=member' },
  { label: '我创建的', icon: 'i-lucide-pen-line', to: '/work-items?filter=created' },
  { label: '待我验证', icon: 'i-lucide-check-circle', to: '/work-items?filter=verify' }
]

export const globalUtilityItems = [
  {
    label: '系统管理',
    icon: 'i-lucide-settings',
    children: [
      { label: '项目管理', icon: 'i-lucide-folder-cog', to: '/admin/projects' },
      { label: '产品管理', icon: 'i-lucide-package-search', to: '/admin/products' },
      { label: '项目模板', icon: 'i-lucide-layers-3', to: '/admin/project-templates' }
    ]
  }
]

// ============================================================
// 项目视图菜单
// ============================================================

export function getProjectMenuItems(projectId: string | number) {
  const pid = projectId
  // 需求入口已移到 ProjectNavbar（条件显示：仅当项目存在 type=requirement target 时）
  return [
    { label: '概览', icon: 'i-lucide-layout-dashboard', to: `/projects/${pid}` },
    { label: '里程碑', icon: 'i-lucide-flag', to: `/projects/${pid}/plan` },
    { label: '目标', icon: 'i-lucide-target', to: `/projects/${pid}/work-items` },
    { label: '任务', icon: 'i-lucide-calendar-check', to: `/projects/${pid}/board` },
    { label: '文档', icon: 'i-lucide-files', to: `/projects/${pid}/documents` },
    { label: '成果', icon: 'i-lucide-package', to: `/projects/${pid}/output` },
    { label: '工时', icon: 'i-lucide-clock', to: `/projects/${pid}/timesheet` },
    { label: '度量', icon: 'i-lucide-bar-chart-3', to: `/projects/${pid}/metrics` }
  ]
}

export function getProjectUtilityItems(projectId: string | number) {
  const pid = projectId
  return [
    { label: '设置', icon: 'i-lucide-settings', to: `/projects/${pid}/settings` }
  ]
}
