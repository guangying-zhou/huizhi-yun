export default defineNuxtPlugin(() => {
  const { setSection } = useConsoleMenus()

  setSection('public', {
    title: '公开入口',
    subtitle: 'Public',
    items: [
      { key: 'home', label: '产品首页', to: '/', icon: 'i-lucide-house' },
      { key: 'pricing', label: '价格方案', to: '/pricing', icon: 'i-lucide-badge-dollar-sign', disabled: true },
      { key: 'docs', label: '文档中心', to: '/docs', icon: 'i-lucide-book-open', disabled: true }
    ]
  })

  setSection('admin', {
    title: '运营控制台',
    subtitle: 'Admin',
    items: [],
    groups: [
      {
        group: '工作台',
        items: [
          { key: 'admin-home', label: '工作台', to: '/admin', icon: 'i-lucide-house' }
        ]
      },
      {
        group: '产品',
        items: [
          { key: 'admin-applications', label: '应用', to: '/admin/applications', icon: 'i-lucide-box', badge: '接入' },
          { key: 'admin-plans', label: '订阅计划', to: '/admin/plans', icon: 'i-lucide-layers' },
          { key: 'admin-enterprise-roles', label: '企业角色', to: '/admin/enterprise-roles', icon: 'i-lucide-users-round' },
          { key: 'admin-app-roles', label: '应用权限角色', to: '/admin/system-roles', icon: 'i-lucide-shield' }
        ]
      },
      {
        group: '运营',
        items: [
          { key: 'admin-tenants', label: '租户', to: '/admin/tenants', icon: 'i-lucide-building-2' },
          { key: 'admin-subscriptions', label: '开通编排', to: '/admin/subscriptions', icon: 'i-lucide-badge-check', badge: '核心' },
          { key: 'admin-subscription-orders', label: '订单管理', to: '/admin/orders', icon: 'i-lucide-receipt-text' },
          { key: 'admin-deployments', label: '运行诊断', to: '/admin/deployments', icon: 'i-lucide-server-cog' }
        ]
      }
    ]
  })

  setSection('dashboard', {
    title: '企业工作台',
    subtitle: 'Dashboard',
    items: [],
    groups: [
      {
        group: '工作台',
        items: [
          { key: 'dashboard-home', label: '企业工作台', to: '/dashboard', icon: 'i-lucide-house' },
          { key: 'dashboard-deployments', label: '部署管理', to: '/dashboard/deployments', icon: 'i-lucide-server-cog', tenantScoped: true },
          { key: 'dashboard-subscription-plans', label: '订阅计划', to: '/dashboard/subscription-plans', icon: 'i-lucide-badge-dollar-sign', tenantScoped: true },
          { key: 'dashboard-observability', label: '访问观测', to: '/dashboard/observability', icon: 'i-lucide-activity', tenantScoped: true }
        ]
      },
      {
        group: '应用与授权',
        items: [
          { key: 'dashboard-applications', label: '应用管理', to: '/dashboard/applications', icon: 'i-lucide-app-window', tenantScoped: true },
          // { key: 'dashboard-roles', label: '角色管理', to: '/dashboard/roles', icon: 'i-lucide-shield-check', tenantScoped: true },
          { key: 'dashboard-authorizations', label: '角色授权', to: '/dashboard/authorizations', icon: 'i-lucide-user-check', tenantScoped: true },
          { key: 'dashboard-member-permissions', label: '成员权限', to: '/dashboard/member-permissions', icon: 'i-lucide-user-cog', tenantScoped: true },
          { key: 'dashboard-role-catalog', label: '岗位职责目录', to: '/dashboard/role-catalog', icon: 'i-lucide-book-user', tenantScoped: true }
          // { key: 'dashboard-templates', label: '授权模板', to: '/dashboard/templates', icon: 'i-lucide-files', tenantScoped: true }
        ]
      },
      {
        group: '目录',
        items: [
          { key: 'dashboard-subjects', label: '主体目录', to: '/dashboard/subjects', icon: 'i-lucide-network', tenantScoped: true },
          { key: 'dashboard-users', label: '成员资料', to: '/dashboard/users', icon: 'i-lucide-users', tenantScoped: true }
        ]
      }
    ]
  })
})
