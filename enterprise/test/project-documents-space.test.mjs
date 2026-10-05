import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { businessModules, navigationContributors, registerBusinessPages, buildBusinessNavigation } from '../composition/registry.mjs'
import { businessAreas, auxiliaryAreas } from '../composition/business-areas.mjs'

test('project documents overview reuses the original Aims page in Enterprise, with unchanged projects:view in project space', () => {
  const pages = registerBusinessPages([], businessModules, '/entry.vue')
  const page = pages.find(page => page.path === '/aims/project-documents')
  assert.ok(page)
  assert.ok(page.file.endsWith('/aims/app/pages/project-documents.vue'))
  assert.equal(page.meta.logicalModule, 'aims')
  assert.equal(page.meta.layout, 'enterprise')
  const nav = buildBusinessNavigation(navigationContributors, businessAreas, auxiliaryAreas)
  const documents = [...nav.primary, ...nav.auxiliary].find(area => area.code === 'documents')
  const space = documents.children.find(group => group.code === 'project')
  const leaf = space.children.find(item => item.to === '/aims/project-documents')
  assert.ok(leaf)
  assert.equal(leaf.label, '项目文档')
  assert.deepEqual(leaf.permission, { resource: 'projects', action: 'view' })
  assert.equal(leaf.module, 'aims')
  assert.ok(documents.children.find(group => group.code === 'department')?.children.find(item => item.label === '部门文档'))
})

test('overview reads the existing owning accessible-list without widening capabilities or changing its project-only predicate', () => {
  const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
  assert.match(read('../server/routes/aims/api/v1/project-documents/accessible.get.ts'), /enterpriseAimsAccessibleProjectDocuments/)
  const owning = read('../../aims/layer/server/internal/projectDocumentAccessible.ts')
  assert.match(owning, /aims\.project-document-accessible-list/)
  assert.match(owning, /scoped\.decision\?\.allowed !== true/)
  const source = read('../../data-runtime/internal/apps/aims/project_documents.go')
  assert.match(source, /NOT \(d\.portfolio_id IS NOT NULL AND d\.project_id IS NULL AND d\.milestone_id IS NULL AND d\.work_item_id IS NULL\)/)
})

test('document menu has four ownership groups while tab routes and their permissions remain registered', () => {
  const nav = buildBusinessNavigation(navigationContributors, businessAreas, auxiliaryAreas)
  const documents = [...nav.primary, ...nav.auxiliary].find(area => area.code === 'documents')
  assert.deepEqual(documents.children.map(group => group.label), ['我的空间', '部门空间', '项目空间', '公司空间'])
  assert.deepEqual(documents.children.map(group => group.children.map(item => item.label)), [
    ['我的文档', '我的文件柜'],
    ['部门文档', '部门文件柜', '会议记录', '部门规章', '对外发文'],
    ['项目文档'],
    ['公司制度', '通知公告', '法务合规', '企业文化', '技术规范', '公司知识库', '各部门开放文档']
  ])
  const settings = [...nav.primary, ...nav.auxiliary].find(area => area.code === 'console')
  assert.equal(settings.label, '设置')
  assert.ok(settings.children.find(group => group.code === 'config').children.some(item => item.label === '文档模板' && item.to === '/codocs/company/templates'))
  const pages = registerBusinessPages([], businessModules, '/entry.vue')
  const leaves = documents.children.flatMap(group => group.children)
  for (const suffix of ['recently', 'shared', 'favorites', 'recycle']) {
    const path = `/codocs/mydocs/${suffix}`
    assert.ok(pages.find(page => page.path === path), path)
    assert.ok(!leaves.some(leaf => leaf.to === path), path)
  }
  for (const leaf of leaves.filter(leaf => leaf.module === 'codocs')) {
    const resource = leaf.to.startsWith('/codocs/departments') ? 'departments' : leaf.to.startsWith('/codocs/company') ? 'company' : 'documents'
    assert.deepEqual(leaf.permission, { resource, action: 'view' }, leaf.label)
  }
})
