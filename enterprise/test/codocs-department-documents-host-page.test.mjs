import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse, compileTemplate } from '@vue/compiler-sfc'

test('department documents Host page compiles and only uses Host department routes', () => {
  const filename = fileURLToPath(new URL('../../codocs/layer/pages/enterprise-department-documents.vue', import.meta.url))
  const source = readFileSync(filename, 'utf8')
  const { descriptor, errors } = parse(source, { filename })
  assert.deepEqual(errors, [])
  assert.ok(descriptor.template)
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: 'codocs-department-documents' }).errors, [])
  assert.doesNotMatch(source, /\/api\/account\//)
  assert.doesNotMatch(source, /\b(window\.(confirm|alert|prompt)|alert|prompt)\(/)
  assert.match(source, /useConfirm\(\)/)
  for (const route of ['departments/mine', 'departments/access', 'departments/folders', 'departments/documents']) assert.match(source, new RegExp(`moduleUrl\\('/api/${route}'`))
  assert.match(source, /useDebouncedSearch\(/)
  assert.match(source, /Idempotency-Key/)
  assert.match(source, /v-if="canManage"/)
  assert.match(source, /暂未开放/)
  for (const action of ['新建文档', '上传', '回收站', '改名\/移动', '设为只读', '下载', '复制', '恢复']) assert.match(source, new RegExp(action))
})

test('department documents page is registered under 部门空间 with departments:view', async () => {
  const { default: entry } = await import('../../codocs/layer/entry.mjs')
  const item = entry.navigation.find(value => value.to === '/codocs/departments')
  assert.ok(item)
  assert.deepEqual(item.permission, { resource: 'departments', action: 'view' })
  assert.equal(item.group, 'department')
  assert.equal(item.area, 'documents')
  const page = entry.pages.find(value => value.path === '/departments')
  assert.ok(page)
  assert.ok(existsSync(page.file))
  const { enterpriseHostRoutes } = await import('../../deploy/test-env/enterprise-host-routes.mjs')
  assert.ok(Object.values(enterpriseHostRoutes).flat().some(route => route === '/codocs/departments'))
})

test('department document list offers rename/move only to the manager or the document owner', () => {
  const source = readFileSync(fileURLToPath(new URL('../../codocs/layer/pages/enterprise-department-documents.vue', import.meta.url)), 'utf8')
  assert.match(source, /const canEditDocumentMetadata = \(doc: DepartmentDocument\) => canWrite\.value\s*&& \(canManage\.value \|\| \(Boolean\(authUser\.value\) && doc\.owner_uid === authUser\.value\)\)/)
  assert.match(source, /v-if="canEditDocumentMetadata\(row\.original\)"\s+size="xs"\s+variant="ghost"\s+color="neutral"\s+@click="openAction\('edit', row\.original\)"/)
  // Copy stays available to every writer.
  assert.match(source, /v-if="canWrite"\s+size="xs"\s+variant="ghost"\s+color="neutral"\s+@click="openAction\('copy', row\.original\)"/)
})
