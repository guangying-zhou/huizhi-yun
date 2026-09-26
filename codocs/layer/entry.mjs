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
    { id: 'codocs.documents.review.shared', area: 'documents', group: 'review', label: '协同文档', to: '/codocs/mydocs/shared', permission: { resource: 'documents', action: 'view' }, order: 10 },
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
    appPage('/documents/:uuid', 'document-editor', 'documents/[uuid]')
  ],
  handlers: [], tasks: []
})
