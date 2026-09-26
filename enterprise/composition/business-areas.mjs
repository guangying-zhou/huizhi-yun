// The 6+2 business areas and their working domains, taken from ADR-019 §4.1 and
// the navigation specification §3. This file is the shape of the menu only:
// modules contribute the third-level pages, and an area or group with no
// contributed page is dropped rather than shown as an empty entry.
export const businessAreas = Object.freeze([
  { code: 'workspace', label: '工作台', icon: 'i-lucide-layout-dashboard', groups: [
    { code: 'today', label: '今日工作', icon: 'i-lucide-sun' },
    { code: 'approval', label: '审批办理', icon: 'i-lucide-stamp' },
    { code: 'self', label: '我的工作', icon: 'i-lucide-user' },
    { code: 'collab', label: '日常协作', icon: 'i-lucide-messages-square' }
  ] },
  { code: 'product', label: '产品', icon: 'i-lucide-package', groups: [
    { code: 'catalog', label: '产品目录', icon: 'i-lucide-book-marked' },
    { code: 'planning', label: '产品规划', icon: 'i-lucide-map' },
    { code: 'release', label: '版本与发布', icon: 'i-lucide-rocket' },
    { code: 'rnd', label: '研发协同', icon: 'i-lucide-code' },
    { code: 'assets', label: '产品资产', icon: 'i-lucide-box' },
    { code: 'commercial', label: '商业规格', icon: 'i-lucide-badge-dollar-sign' }
  ] },
  { code: 'sales', label: '销售', icon: 'i-lucide-handshake', groups: [
    { code: 'customer', label: '客户经营', icon: 'i-lucide-building-2' },
    { code: 'opportunity', label: '销售机会', icon: 'i-lucide-target' },
    { code: 'quote', label: '报价与投标', icon: 'i-lucide-file-text' },
    { code: 'contract', label: '合同管理', icon: 'i-lucide-file-signature' },
    { code: 'settlement', label: '结算与回款', icon: 'i-lucide-wallet' }
  ] },
  { code: 'delivery', label: '交付与服务', icon: 'i-lucide-truck', groups: [
    { code: 'project', label: '项目管理', icon: 'i-lucide-folder-kanban' },
    { code: 'execution', label: '执行协同', icon: 'i-lucide-list-checks' },
    { code: 'quality', label: '成果与质量', icon: 'i-lucide-badge-check' },
    { code: 'customer-assets', label: '客户资产', icon: 'i-lucide-server' },
    { code: 'service', label: '维护服务', icon: 'i-lucide-wrench' }
  ] },
  { code: 'operations', label: '经营', icon: 'i-lucide-chart-line', groups: [
    { code: 'analysis', label: '经营分析', icon: 'i-lucide-chart-column' },
    { code: 'finance', label: '财务收支', icon: 'i-lucide-banknote' },
    { code: 'treasury', label: '账户与资金', icon: 'i-lucide-landmark' },
    { code: 'costing', label: '成本核算', icon: 'i-lucide-calculator' },
    { code: 'resource', label: '企业资源', icon: 'i-lucide-boxes' }
  ] },
  { code: 'people', label: '人力资源', icon: 'i-lucide-users', groups: [
    { code: 'org', label: '组织与岗位', icon: 'i-lucide-network' },
    { code: 'employee', label: '员工管理', icon: 'i-lucide-user-round' },
    { code: 'cost', label: '人员成本', icon: 'i-lucide-coins' },
    { code: 'performance', label: '绩效管理', icon: 'i-lucide-trending-up' }
  ] }
])

// The auxiliary area sits below a divider, as in ADR-019 §4.1's "6+2".
export const auxiliaryAreas = Object.freeze([
  { code: 'documents', label: '文档', icon: 'i-lucide-files', groups: [
    { code: 'space', label: '文档空间', icon: 'i-lucide-folder-open' },
    { code: 'review', label: '文档协作', icon: 'i-lucide-message-square-text' },
    { code: 'template', label: '模板与复用', icon: 'i-lucide-layout-template' }
  ] },
  { code: 'console', label: '控制台', icon: 'i-lucide-settings', groups: [
    { code: 'enterprise', label: '企业与组织', icon: 'i-lucide-building' },
    { code: 'identity', label: '身份与权限', icon: 'i-lucide-key-round' },
    { code: 'config', label: '业务配置', icon: 'i-lucide-sliders-horizontal' },
    { code: 'workflow', label: '流程配置', icon: 'i-lucide-git-branch' },
    { code: 'integration', label: '集成与运行', icon: 'i-lucide-plug' },
    { code: 'audit', label: '安全与审计', icon: 'i-lucide-shield-check' }
  ] }
])
