import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { businessModules, registerBusinessPages } from '../composition/registry.mjs'

test('document Host gates reference the manifest project resource, retaining object relationship checks', () => {
  const root = resolve(import.meta.dirname, '../..')
  const manifest = JSON.parse(readFileSync(resolve(root, 'aims/app.manifest.json'), 'utf8'))
  assert.ok(manifest.resources.some(resource => resource.code === 'projects' && resource.actions.includes('view')))
  for (const name of ['enterpriseAimsAccessibleDocuments', 'enterpriseAimsProjectDocuments', 'enterpriseAimsProjectDocumentWrites', 'enterpriseAimsProjectDocumentAccess', 'enterpriseAimsProjectDocumentFiles', 'enterpriseAimsProjectDocumentSources']) {
    const source = readFileSync(resolve(root, `enterprise/server/utils/${name}.ts`), 'utf8')
    assert.match(source, /authorizationResourcesAllow\(authorization.resources, 'projects'/)
    assert.doesNotMatch(source, /authorizationResourcesAllow\(authorization.resources, 'documents'/)
    assert.match(source, /trustedServiceRequestHeaders\(event, 'aims'\)/)
  }
  assert.match(readFileSync(resolve(root, 'aims/server/utils/projectDocumentWrites.ts'), 'utf8'), /!isScopedProjectAdmin && !isProjectMember\(project, uid, members\)/)
  assert.match(readFileSync(resolve(root, 'aims/server/utils/projectDocumentAccessPolicy.ts'), 'utf8'), /if \(!context.isManager\) throw createError/)
  const middleware = readFileSync(resolve(root, 'aims/server/middleware/tenant-runtime.ts'), 'utf8')
  for (const endpoint of ['project-documents/read', 'project-document-files/read', 'project-document-sources/read', 'project-document-writes/execute', 'project-document-access/execute', 'accessible-project-documents/read']) {
    assert.ok(middleware.includes(`normalizedApiV1Path(pathname) === '/api/v1/service/enterprise/${endpoint}'`), `prefixed route must reach its dedicated signature/capability guard: ${endpoint}`)
  }
})

test('Aims project document routes mount only with the two-hop identity contract', () => {
  const root = resolve(import.meta.dirname, '../..')
  const pages = registerBusinessPages([], businessModules, 'entry.vue')
  for (const path of ['/aims/projects/:id/documents', '/aims/projects/:id/documents/:documentId', '/aims/projects/:id/documents/:documentId/open']) assert.ok(pages.some(page => page.path === path), `missing Host-ready document route: ${path}`)
  for (const path of ['enterprise/server/routes/aims/api/v1/projects/[id]/documents/index.get.ts', 'enterprise/server/routes/aims/api/v1/projects/[id]/documents/[documentId].get.ts', 'enterprise/server/routes/aims/api/v1/projects/[id]/documents/[documentId]/open.get.ts', 'aims/server/api/v1/service/enterprise/project-documents/read.post.ts']) assert.equal(existsSync(resolve(root, path)), true, `missing project document proxy route: ${path}`)
  const sender = readFileSync(resolve(root, 'enterprise/server/utils/enterpriseAimsProjectDocuments.ts'), 'utf8')
  assert.match(sender, /sourceApp:\s*'enterprise'/)
  assert.match(sender, /sourceClientId:\s*'enterprise\.runtime'/)
  const receiver = readFileSync(resolve(root, 'aims/server/utils/enterpriseProjectDocumentsService.ts'), 'utf8')
  assert.match(receiver, /auth\.clientCode !== 'enterprise\.runtime'/)
  assert.match(receiver, /getCodocsProjectDocumentContent/)
  const codocs = readFileSync(resolve(root, 'aims/server/utils/codocsApi.ts'), 'utf8')
  // 只截取该函数体：文件后面还有其他仍固定 aims.runtime 的调用方（它们不在本次范围内）。
  const contentStart = codocs.indexOf('export async function getCodocsProjectDocumentContent')
  const nextTopLevel = /\n(?:export |type |interface |async function |function |const )/g
  nextTopLevel.lastIndex = contentStart + 1
  const contentSender = codocs.slice(contentStart, nextTopLevel.exec(codocs)?.index ?? undefined)
  // 来源应用与 source client 同源派生，宿主不借 aims.runtime，Aims 也不借 enterprise.runtime。
  assert.match(contentSender, /const sourceApp = params\.sourceApp === 'enterprise' \? 'enterprise' : 'aims'/)
  assert.match(contentSender, /sourceApp,/)
  assert.match(contentSender, /sourceClientId: `\$\{sourceApp\}\.runtime`/)
  assert.doesNotMatch(contentSender, /sourceClientId:\s*'aims\.runtime'/)
})

// ADR-018 §3.2：宿主直连 Codocs 读正文是正式契约上的第二条来源，
// 不是放宽 Aims 那条；capability 与 audience 由包装器单点声明，
// readiness 策略从这里推导，不维护第二份清单。
test('Host Codocs project document content link declares one capability and its own identity', () => {
  const root = resolve(import.meta.dirname, '../..')
  const wrapper = readFileSync(resolve(root, 'enterprise/server/utils/enterpriseCodocsProjectDocument.ts'), 'utf8')
  assert.match(wrapper, /const requiredCapability = 'codocs:project-document:content:read'/)
  assert.match(wrapper, /const audience = 'codocs'/)
  assert.match(wrapper, /sourceApp: 'enterprise'/)
  // 本域项目文档访问必须先判定，再去 Codocs 取正文。
  assert.ok(wrapper.indexOf('assertCodocsProjectDocumentAccess') < wrapper.indexOf('getCodocsProjectDocumentContent('))
  assert.ok(wrapper.indexOf('requireEnterpriseUser') < wrapper.indexOf('assertCodocsProjectDocumentAccess'))
  assert.equal(existsSync(resolve(root, 'enterprise/server/routes/aims/api/v1/codocs/documents/[uuid]/content.get.ts')), true)

  const policy = readFileSync(resolve(root, 'codocs/server/lib/serviceAuthPolicy.ts'), 'utf8')
  assert.match(policy, /ENTERPRISE_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH[\s\S]*?allowedApps: \['enterprise'\], allowedClientCodes: \['enterprise\.runtime'\], exactScope: true/)
  // 并列而不是放宽：Aims 那条仍然只认 aims / aims.runtime。
  assert.match(policy, /AIMS_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH[\s\S]*?allowedApps: \['aims'\], allowedClientCodes: \['aims\.runtime'\], exactScope: true/)
  const codocsManifest = JSON.parse(readFileSync(resolve(root, 'codocs/app.manifest.json'), 'utf8'))
  assert.ok(codocsManifest.resources.some(entry => entry.code === 'project-document' && entry.actions.includes('content:read')))
})

test('source metadata reads require project visibility before object lookup', () => {
  const root = resolve(import.meta.dirname, '../..')
  const source = readFileSync(resolve(root, 'data-runtime/internal/apps/aims/project_documents.go'), 'utf8')
  for (const [startName, endName] of [['listProjectDocuments', 'createProjectDocumentBinding'], ['projectDocumentDetail', 'createDirectDocument']]) {
    const start = source.indexOf(`func (a *Adapter) ${startName}`)
    const end = source.indexOf(`func (a *Adapter) ${endName}`, start)
    const segment = source.slice(start, end > start ? end : undefined)
    assert.ok(start >= 0)
    assert.ok(segment.indexOf('requireProjectReadAccess') >= 0)
    assert.ok(segment.indexOf('requireProjectReadAccess') < segment.indexOf('QueryContext'))
  }
})
