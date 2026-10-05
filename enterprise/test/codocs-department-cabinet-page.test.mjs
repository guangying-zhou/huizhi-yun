import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import entry from '../../codocs/layer/entry.mjs'
import { businessApiRoutes } from '../composition/business-api-routes.generated.mjs'

test('department cabinet page compiles as a complete Host SFC', () => {
  const filename = fileURLToPath(new URL('../../codocs/app/pages/departments/cabinet.vue', import.meta.url))
  const source = readFileSync(filename, 'utf8')
  const { descriptor, errors } = parse(source, { filename })
  assert.deepEqual(errors, [])
  assert.ok(descriptor.template)
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: 'codocs-department-cabinet' }).errors, [])
  assert.match(source, /moduleUrl\('\/api\/dept-cabinet\//)
  assert.match(source, /useConfirm\(/)
  assert.match(source, /CommonEmptyState/)
  assert.match(source, /UPagination/)
  assert.match(source, /response\.data\?\.canManage === true && response\.data\?\.canEdit === true/)
  assert.match(source, /pageSize: 100/)
  assert.doesNotMatch(source, /pageSize: 200/)
})

test('cabinet edit display uses the Host authorization snapshot and folder picker stays within backend page limit', () => {
  const access = readFileSync(fileURLToPath(new URL('../server/routes/codocs/api/dept-cabinet/access.get.ts', import.meta.url)), 'utf8')
  const folders = readFileSync(fileURLToPath(new URL('../server/routes/codocs/api/dept-cabinet/document-folders.get.ts', import.meta.url)), 'utf8')
  assert.match(access, /authorizationResourcesAllow\(snapshot\.resources, 'departments', 'edit'/)
  assert.match(access, /canEdit/)
  assert.match(folders, /pageSize \|\| '100'/)
  assert.match(folders, /Number\(pageSize\) > 100/)
})

test('department cabinet registers exact Host page and method routes', () => {
  const nav = entry.navigation.find(item => item.to === '/codocs/departments/cabinet')
  assert.deepEqual(nav?.permission, { resource: 'departments', action: 'view' })
  assert.equal(nav.group, 'department')
  assert.ok(entry.pages.some(page => page.path === '/departments/cabinet'))
  const actual = new Set(businessApiRoutes.map(([method, path]) => `${method} ${path}`))
  for (const [method, path] of [
    ['GET', '/codocs/api/dept-cabinet'], ['GET', '/codocs/api/dept-cabinet/folders'],
    ['GET', '/codocs/api/dept-cabinet/access'], ['GET', '/codocs/api/dept-cabinet/document-folders'],
    ['GET', '/codocs/api/dept-cabinet/:uuid'], ['GET', '/codocs/api/dept-cabinet/:uuid/download'],
    ['GET', '/codocs/api/dept-cabinet/:uuid/preview'], ['GET', '/codocs/api/dept-cabinet/:uuid/preview-html'],
    ['GET', '/codocs/api/dept-cabinet/:uuid/preview-pptx'], ['GET', '/codocs/api/dept-cabinet/:uuid/converted-info'],
    ['POST', '/codocs/api/dept-cabinet/upload'], ['POST', '/codocs/api/dept-cabinet/publish'],
    ['POST', '/codocs/api/dept-cabinet/:uuid/to-document'], ['POST', '/codocs/api/dept-cabinet/folders'],
    ['PATCH', '/codocs/api/dept-cabinet/:uuid'], ['DELETE', '/codocs/api/dept-cabinet/:uuid'],
    ['PATCH', '/codocs/api/dept-cabinet/folders/:id'], ['DELETE', '/codocs/api/dept-cabinet/folders/:id']
  ]) assert.ok(actual.has(`${method} ${path}`), `${method} ${path}`)
})
