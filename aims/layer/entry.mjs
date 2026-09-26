import { fileURLToPath } from 'node:url'

const page = (path, name, source, children) => ({ path, name, file: fileURLToPath(new URL(`../app/pages/${source}.vue`, import.meta.url)), ...(children ? { children } : {}) })
const layerPage = (path, name, source) => ({ path, name, file: fileURLToPath(new URL(`./pages/${source}.vue`, import.meta.url)) })

// A route is listed here only when Enterprise owns both its BFF and Runtime
// operation.  The standalone Aims application remains the complete surface
// while the rest of project management is migrated in explicit batches.
const hostReadiness = Object.freeze({
  entryPath: '/projects',
  deferredPages: Object.freeze([
    '/projects/:id/members/:uid — 源应用没有稳定的独立成员详情接口'
  ])
})

// Third-level pages this module contributes, placed by business area rather
// than by owning application: ADR-019 §4.1 keeps Aims out of the top level.
// Labels follow the navigation specification §3 so one page is discovered under
// one name; a page is listed only when the Host actually serves it.
const navigation = Object.freeze([
  { id: 'aims.product.planning.products', area: 'product', group: 'planning', label: '产品管理空间', to: '/aims/products', permission: { resource: 'products', action: 'view' }, order: 1 },
  { id: 'aims.delivery.project.projects', area: 'delivery', group: 'project', label: '项目总览', to: '/aims/projects', permission: { resource: 'projects', action: 'view' }, order: 1 },
  { id: 'aims.delivery.execution.work-items', area: 'delivery', group: 'execution', label: '任务中心', to: '/aims/work-items', permission: { resource: 'work_items', action: 'view' }, order: 1 },
  { id: 'aims.delivery.execution.timesheet', area: 'delivery', group: 'execution', label: '工时日历', to: '/aims/timesheet', permission: { resource: 'timesheet', action: 'view' }, order: 2 },
  { id: 'aims.delivery.execution.weekly-reports', area: 'delivery', group: 'execution', label: '周报汇总', to: '/aims/weekly-reports', permission: { resource: 'weekly_reports', action: 'view' }, order: 3 }
])

// A project is a complex object worth staying inside, so the sidebar switches
// to object mode for it. Groups follow the navigation specification's default
// project grouping, reduced to the pages this Host serves. Paths are relative
// to the object root and validated against the registered routes at build time.
const objectWorkspaces = Object.freeze([
  {
    code: 'aims-project',
    label: '项目',
    base: '/aims/projects/:id',
    backTo: '/aims/projects',
    backLabel: '返回项目总览',
    actions: [{ id: 'aims.project.create-work-item', permission: { resource: 'work_items', action: 'create' } }],
    groups: [
      { id: 'overview', label: '概览', items: [{ id: 'aims.project.overview', label: '项目概览', path: '', permission: { resource: 'projects', action: 'view' } }] },
      { id: 'plan-execution', label: '计划与执行', items: [{ id: 'aims.project.plan', label: '里程碑', path: '/plan', permission: { resource: 'work_items', action: 'view' } }, { id: 'aims.project.board', label: '任务看板', path: '/board', permission: { resource: 'work_items', action: 'view' } }, { id: 'aims.project.metrics', label: '度量分析', path: '/metrics', permission: { resource: 'projects', action: 'view' } }, { id: 'aims.project.risks', label: '风险管控', path: '/risks', permission: { resource: 'projects', action: 'view' } }] },
      { id: 'delivery-quality', label: '交付与质量', items: [{ id: 'aims.project.requirements', label: '需求', path: '/requirements', permission: { resource: 'requirements', action: 'view' } }, { id: 'aims.project.documents', label: '项目文档', path: '/documents', permission: { resource: 'projects', action: 'view' } }, { id: 'aims.project.output', label: '项目产出', path: '/output', permission: { resource: 'projects', action: 'view' } }, { id: 'aims.project.releases', label: '项目版本', path: '/releases', permission: { resource: 'projects', action: 'view' } }] },
      { id: 'team-investment', label: '团队与投入', items: [{ id: 'aims.project.members', label: '项目成员', path: '/members', permission: { resource: 'projects', action: 'view' } }, { id: 'aims.project.timesheet', label: '工时', path: '/timesheet', permission: { resource: 'timesheet', action: 'view' } }, { id: 'aims.project.weekly-reports', label: '周报', path: '/weekly-reports', permission: { resource: 'weekly_reports', action: 'view' } }] },
      { id: 'project-management', label: '项目管理', items: [{ id: 'aims.project.edit', label: '项目设置', path: '/edit', permission: { resource: 'projects', action: 'edit' } }] }
    ]
  }
])

export default Object.freeze({
  code: 'aims', prefix: '/aims', label: '产品与研发',
  hostReadiness, navigation, objectWorkspaces,
  pages: [page('/products', 'products-shell', 'products', [
    page('', 'products', 'products/index'),
    page(':productCode', 'product-workspace', 'products/[productCode]', [
      page('', 'product-overview', 'products/[productCode]/index'),
      page('structure', 'product-structure', 'products/[productCode]/structure'),
      page('features', 'product-features-legacy', 'products/[productCode]/features/index'),
      page('components', 'product-components-legacy', 'products/[productCode]/components'),
      page('adoption', 'product-adoption', 'products/[productCode]/adoption'),
      layerPage('documents', 'product-documents', 'enterprise-product-documents'),
      layerPage('cycles', 'product-cycles', 'enterprise-product-cycles'),
      page('features/:featureId', 'product-feature-index', 'products/[productCode]/features/[featureId]/index'),
      page('features/:featureId/requests', 'product-feature-requests', 'products/[productCode]/features/[featureId]/requests'),
      page('features/:featureId/lifecycle', 'product-feature-lifecycle', 'products/[productCode]/features/[featureId]/lifecycle'),
      page('features/:featureId/roadmap', 'product-feature-roadmap', 'products/[productCode]/features/[featureId]/roadmap'),
      page('requests', 'product-requests', 'products/[productCode]/requests'),
      page('planning-items/:itemId/handoff', 'product-handoff', 'products/[productCode]/planning-items/[itemId]/handoff'),
      page('execution-coordination', 'product-execution-coordination', 'products/[productCode]/execution-coordination'),
      page('planning', 'product-planning', 'products/[productCode]/planning'),
      page('versions', 'product-versions', 'products/[productCode]/versions/index'),
      page('versions/:versionId', 'product-version', 'products/[productCode]/versions/[versionId]', [
        page('', 'product-version-overview', 'products/[productCode]/versions/[versionId]/index'),
        page('acceptance', 'product-version-acceptance', 'products/[productCode]/versions/[versionId]/acceptance'),
        page('acceptances', 'product-version-acceptances', 'products/[productCode]/versions/[versionId]/acceptances/index'),
        page('acceptances/:acceptanceId', 'product-version-acceptances-detail', 'products/[productCode]/versions/[versionId]/acceptances/[acceptanceId]'),
        page('releases', 'product-version-releases', 'products/[productCode]/versions/[versionId]/releases/index'),
        page('releases/:recordId', 'product-version-releases-detail', 'products/[productCode]/versions/[versionId]/releases/[recordId]'),
        page('plan', 'product-version-plan', 'products/[productCode]/versions/[versionId]/plan'),
        layerPage('features', 'product-version-features', 'enterprise-product-version-features')
      ])
    ])
  ]),
  // 项目总览改用 Aims 原页面。闭包经 check-page-migration 全清：
  // 项目集 CRUD 与彻底删除已补齐，后者要求 admin:admin（与 Aims 一致）。
  page('/projects', 'projects', 'projects/index'),
  layerPage('/projects/new', 'project-new', 'enterprise-project-new'),
  layerPage('/projects/:id', 'project-detail', 'enterprise-project-detail'),
  layerPage('/projects/:id/edit', 'project-edit', 'enterprise-project-edit'),
  layerPage('/projects/:projectId/work-items/new', 'work-item-new', 'enterprise-work-item-form'),
  layerPage('/work-items/:id/edit', 'work-item-edit', 'enterprise-work-item-form'),
  layerPage('/work-items/:id/association', 'work-item-association', 'enterprise-work-item-association'),
  page('/projects/:id/timesheet', 'project-timesheet', 'projects/[id]/timesheet'),
  layerPage('/projects/:id/timesheet/:entryId', 'project-time-entry-detail', 'enterprise-project-time-entry-detail'),
  page('/projects/:id/weekly-reports', 'project-weekly-reports', 'projects/[id]/weekly-reports'),
  layerPage('/projects/:id/weekly-reports/:periodKey', 'project-weekly-report-detail', 'enterprise-project-weekly-report-detail'),
  layerPage('/projects/:id/members', 'project-members', 'enterprise-project-members'),
  page('/projects/:id/documents', 'project-documents', 'projects/[id]/documents'),
  layerPage('/projects/:id/documents/:documentId', 'project-document-detail', 'enterprise-project-document-detail'),
  layerPage('/projects/:id/documents/:documentId/open', 'project-document-open', 'enterprise-project-document-open'),
  layerPage('/projects/:id/requirements', 'project-requirements', 'enterprise-project-requirements'),
  layerPage('/projects/:id/requirements/:requirementId', 'project-requirement-detail', 'enterprise-project-requirement-detail'),
  layerPage('/projects/:id/metrics', 'project-metrics', 'enterprise-project-metrics'),
  layerPage('/projects/:id/risks', 'project-risks', 'enterprise-project-risks'),
  layerPage('/projects/:id/output', 'project-output', 'enterprise-project-output'),
  layerPage('/projects/:id/output/:deliverableId', 'project-output-detail', 'enterprise-project-output-detail'),
  layerPage('/projects/:id/releases', 'project-releases', 'enterprise-project-releases'),
  layerPage('/projects/:id/releases/:releaseId', 'project-release-detail', 'enterprise-project-release-detail'),
  page('/projects/:id/plan', 'project-plan', 'projects/[id]/plan'),
  // 任务看板改用 Aims 原页面。闭包经 check-page-migration 检查：别名、显式导入、
  // 模板组件、moduleUrl 包装均已清零；端点只差本页不调用的 DELETE /projects/:id
  // （破坏性操作，Aims 要求 admin:admin，迁移项目列表页时再连同专用鉴权一起做）。
  page('/projects/:id/board', 'project-board', 'projects/[id]/board'),
  // 看板点卡片会跳进这一页；不注册就是死链（回归实测 404）。
  page('/projects/:id/board/:workItemId/execution', 'project-board-execution', 'projects/[id]/board/[workItemId]/execution'),
  page('/timesheet', 'timesheet', 'timesheet'),
  page('/weekly-reports', 'weekly-reports', 'weekly-reports'),
  // 项目工作项改用 Aims 原页面（2307 行）。依赖闭包已补齐：工作项子资源（第 1 批）、
  // useProjectStore 与 ProjectNavbar 的共享接口（第 0 批）、交付物与项目版本（第 2 批）。
  // 页面与 TargetEditModal / TargetInfoModal 的调用已统一经 moduleUrl，独立应用不受影响。
  page('/projects/:id/work-items', 'project-work-items', 'projects/[id]/work-items'),
  // 路径形状必须与原页面一致：append 会跳 breakdown，看板执行页会跳 decompose，
  // 挂在别处（此前的 /work-items/:id/breakdown）就是死链（回归实测 404）。
  page('/projects/:id/work-items/:workItemId/append', 'project-work-item-append', 'projects/[id]/work-items/[workItemId]/append'),
  page('/projects/:id/work-items/:workItemId/breakdown', 'project-work-item-breakdown', 'projects/[id]/work-items/[workItemId]/breakdown'),
  page('/projects/:id/work-items/:workItemId/decompose', 'project-work-item-decompose', 'projects/[id]/work-items/[workItemId]/decompose'),
  page('/work-items', 'work-items', 'work-items'),
  layerPage('/work-items/:id', 'work-item-detail', 'enterprise-work-item-detail')],
  handlers: [], tasks: []
})
