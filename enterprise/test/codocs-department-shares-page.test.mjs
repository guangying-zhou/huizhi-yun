import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import { businessApiRoutes } from '../composition/business-api-routes.generated.mjs'

test('pending department shares compiles with Host path and explicit acceptance text', () => {
  const filename = fileURLToPath(new URL('../../codocs/app/components/department/PendingDeptShares.vue', import.meta.url))
  const source = readFileSync(filename, 'utf8')
  const { descriptor, errors } = parse(source, { filename })
  assert.deepEqual(errors, [])
  assert.ok(descriptor.template)
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: 'codocs-pending-dept-shares' }).errors, [])
  assert.match(source, /moduleUrl\('\/api\/dept-shares'\)/)
  assert.match(source, /moduleUrl\(`\/api\/dept-shares\/\$\{item\.id\}`\)/)
  assert.match(source, /useConfirm\(\)/)
  assert.match(source, /转为部门文档，作者保持不变/)
})

test('department shares register only exact GET and PATCH Host paths', () => {
  const actual = new Set(businessApiRoutes.map(([method, path]) => `${method} ${path}`))
  assert.ok(actual.has('GET /codocs/api/dept-shares'))
  assert.ok(actual.has('PATCH /codocs/api/dept-shares/:id'))
})

test('Host department document page mounts the manager transfer inbox and refreshes after acceptance', () => {
  const filename = fileURLToPath(new URL('../../codocs/layer/pages/enterprise-department-documents.vue', import.meta.url))
  const source = readFileSync(filename, 'utf8')
  const { descriptor, errors } = parse(source, { filename })
  assert.deepEqual(errors, [])
  assert.ok(descriptor.template)
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: 'codocs-host-department-documents' }).errors, [])
  assert.match(source, /<PendingDeptShares[\s\S]*v-if="deptCode && canManage"[\s\S]*@accepted="loadDocuments\(\)"/)
})
