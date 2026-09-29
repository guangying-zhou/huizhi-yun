import { fileURLToPath } from 'node:url'

const page = (path, name, source) => ({
  path,
  name,
  file: fileURLToPath(new URL(`./pages/${source}.vue`, import.meta.url))
})
const appPage = (path, name, source) => ({
  path,
  name,
  file: fileURLToPath(new URL(`../app/pages/${source}.vue`, import.meta.url))
})

// The full first-party document page composes into the Host. The legacy editor
// shell and Collab service remain only for consumers not yet migrated; slides
// remain deferred while the rest of mydocs is composed into Enterprise.
export default Object.freeze({
  code: 'codocs', prefix: '/codocs', label: '协同文档',
  hostReadiness: Object.freeze({ entryPath: '/mydocs', deferredPages: Object.freeze(['/mydocs/slides']) }),
  navigation: Object.freeze([
    { id: 'codocs.documents.space.mydocs', area: 'documents', group: 'space', label: '我的文档', to: '/codocs/mydocs', permission: { resource: 'documents', action: 'view' }, order: 10 },
    { id: 'codocs.documents.space.cabinet', area: 'documents', group: 'space', label: '文件柜', to: '/codocs/mydocs/cabinet', permission: { resource: 'documents', action: 'view' }, order: 20 },
    { id: 'codocs.documents.space.favorites', area: 'documents', group: 'space', label: '收藏', to: '/codocs/mydocs/favorites', permission: { resource: 'documents', action: 'view' }, order: 30 },
    { id: 'codocs.documents.space.recently', area: 'documents', group: 'space', label: '最近使用', to: '/codocs/mydocs/recently', permission: { resource: 'documents', action: 'view' }, order: 40 },
    { id: 'codocs.documents.space.recycle', area: 'documents', group: 'space', label: '回收站', to: '/codocs/mydocs/recycle', permission: { resource: 'documents', action: 'view' }, order: 50 },
    { id: 'codocs.documents.space.department-documents', area: 'documents', group: 'space', label: '部门文档', to: '/codocs/departments', permission: { resource: 'departments', action: 'view' }, order: 55 },
    { id: 'codocs.documents.space.department-records', area: 'documents', group: 'space', label: '会议记录', to: '/codocs/departments/records', permission: { resource: 'departments', action: 'view' }, order: 60 },
    { id: 'codocs.documents.space.department-cabinet', area: 'documents', group: 'space', label: '部门文件柜', to: '/codocs/departments/cabinet', permission: { resource: 'departments', action: 'view' }, order: 55 },
    { id: 'codocs.documents.space.department-outsides', area: 'documents', group: 'space', label: '对外发文', to: '/codocs/departments/outsides', permission: { resource: 'departments', action: 'view' }, order: 70 },
    { id: 'codocs.documents.space.department-rules', area: 'documents', group: 'space', label: '部门规章', to: '/codocs/departments/rules', permission: { resource: 'departments', action: 'view' }, order: 80 },
    { id: 'codocs.documents.review.shared', area: 'documents', group: 'review', label: '协同文档', to: '/codocs/mydocs/shared', permission: { resource: 'documents', action: 'view' }, order: 10 },
    { id: 'codocs.documents.review.open-department-docs', area: 'documents', group: 'review', label: '部门开放文档', to: '/codocs/company/open-department-docs', permission: { resource: 'company', action: 'view' }, order: 20 },
    { id: 'codocs.documents.company.rules', area: 'documents', group: 'company', label: '公司制度', to: '/codocs/company/rules', permission: { resource: 'company', action: 'view' }, order: 10 },
    { id: 'codocs.documents.company.notice', area: 'documents', group: 'company', label: '通知公告', to: '/codocs/company/notice', permission: { resource: 'company', action: 'view' }, order: 20 },
    { id: 'codocs.documents.company.legal', area: 'documents', group: 'company', label: '法务合规', to: '/codocs/company/legal', permission: { resource: 'company', action: 'view' }, order: 30 },
    { id: 'codocs.documents.company.culture', area: 'documents', group: 'company', label: '企业文化', to: '/codocs/company/culture', permission: { resource: 'company', action: 'view' }, order: 40 },
    { id: 'codocs.documents.company.tech-specs', area: 'documents', group: 'company', label: '技术规范', to: '/codocs/company/tech-specs', permission: { resource: 'company', action: 'view' }, order: 50 },
    { id: 'codocs.documents.company.knowledge', area: 'documents', group: 'company', label: '公司知识库', to: '/codocs/company/knowledge', permission: { resource: 'company', action: 'view' }, order: 60 },
    { id: 'codocs.documents.template.company', area: 'documents', group: 'template', label: '文档模板', to: '/codocs/company/templates', permission: { resource: 'company', action: 'view' }, order: 10 },
    { id: 'codocs.workspace.self.journal', area: 'workspace', group: 'self', label: '工作汇报', to: '/codocs/mydocs/journal', permission: { resource: 'documents', action: 'view' }, order: 30 }
  ]), objectWorkspaces: Object.freeze([]),
  pages: [
    appPage('/mydocs', 'mydocs', 'mydocs/index'),
    appPage('/mydocs/cabinet', 'mydocs-cabinet', 'mydocs/cabinet'),
    appPage('/mydocs/favorites', 'mydocs-favorites', 'mydocs/favorites'),
    appPage('/mydocs/recently', 'mydocs-recently', 'mydocs/recently'),
    appPage('/mydocs/recycle', 'mydocs-recycle', 'mydocs/recycle'),
    appPage('/mydocs/shared', 'mydocs-shared', 'mydocs/shared'),
    appPage('/mydocs/journal', 'mydocs-journal', 'mydocs/journal'),
    // Legacy URLs intentionally reuse the consolidated work-report page.
    appPage('/mydocs/worklogs', 'mydocs-worklogs', 'mydocs/journal'),
    appPage('/mydocs/weekly-reports', 'mydocs-weekly-reports', 'mydocs/journal'),
    appPage('/documents/:uuid', 'document-editor', 'documents/[uuid]'),
    page('/departments', 'department-documents', 'enterprise-department-documents'),
    appPage('/departments/records', 'department-records', 'departments/records'),
    appPage('/departments/cabinet', 'department-cabinet', 'departments/cabinet'),
    appPage('/departments/outsides', 'department-outsides', 'departments/outsides'),
    appPage('/departments/rules', 'department-rules', 'departments/rules'),
    appPage('/company/rules', 'company-rules', 'company/rules'),
    appPage('/company/notice', 'company-notice', 'company/notice'),
    appPage('/company/legal', 'company-legal', 'company/legal'),
    appPage('/company/culture', 'company-culture', 'company/culture'),
    appPage('/company/tech-specs', 'company-tech-specs', 'company/tech-specs'),
    appPage('/company/knowledge', 'company-knowledge', 'company/knowledge'),
    appPage('/company/templates', 'company-templates', 'company/templates'),
    appPage('/company/open-department-docs', 'company-open-department-docs', 'company/open-department-docs'),
    appPage('/company/document', 'company-document', 'company/document'),
    appPage('/departments/document', 'department-document', 'company/department-document'),
    appPage('/s/:token', 'published-asset-short-link', 's/[token]')
  ],
  handlers: [], tasks: []
})
