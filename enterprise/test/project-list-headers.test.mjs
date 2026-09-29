import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import vm from 'node:vm'
import ts from 'typescript'
import { baseParse } from '@vue/compiler-dom'

const pages = ['members', 'requirements', 'metrics', 'risks', 'output', 'releases']
const read = name => readFileSync(new URL(`../../aims/layer/pages/enterprise-project-${name}.vue`, import.meta.url), 'utf8')
function elements(node, tag) {
  return [...(node.type === 1 && node.tag === tag ? [node] : []), ...(node.children || []).flatMap(child => elements(child, tag))]
}
function slot(node, name) {
  return (node.children || []).find(child => child.type === 1 && child.tag === 'template' && child.props.some(prop => prop.type === 7 && prop.name === 'slot' && prop.arg?.content === name))
}

for (const name of pages) {
  test(`project ${name} list keeps one shared header within the panel body`, () => {
    const { descriptor, errors } = parse(read(name))
    assert.deepEqual(errors, [])
    const root = baseParse(descriptor.template.content)
    const panels = elements(root, 'UDashboardPanel')
    assert.equal(panels.length, 1)
    const body = slot(panels[0], 'body')
    assert.ok(body)
    assert.equal(elements(body, 'ProjectNavbar').length, 1)
    assert.equal(elements(root, 'h1').length, 0)
    assert.doesNotMatch(descriptor.template.content, /返回项目|保留源系统|仅提供只读查看/)
    for (const tag of ['UModal', 'USlideover']) assert.equal(elements(root, tag).length, elements(body, tag).length)
  })
}

test('members retains manager-gated add and existing member actions, filters and table', () => {
  const source = read('members')
  const root = baseParse(parse(source).descriptor.template.content)
  const actions = slot(elements(root, 'ProjectNavbar')[0], 'actions')
  assert.match(actions.loc.source, /v-if="canManage"/)
  assert.match(actions.loc.source, /@click="showAdd=true"/)
  assert.match(source, /write\('role', row.original.uid/)
  assert.match(source, /write\('remove', row.original.uid/)
  assert.match(source, /PROJECT_ROLE_LABELS/ )
  assert.match(source, /userNames.get\(row.original.uid\)/)
  assert.match(source, /tone: 'danger'/)
  assert.match(elements(root, 'UModal')[0].loc.source, /v-model:open="showAdd"/)
  assert.match(source, /v-model="search"/)
  assert.match(source, /:loading="loading"/)
})

test('output and releases preserve page controls and object links beneath the header', () => {
  for (const name of ['output', 'releases']) {
    const source = read(name)
    assert.match(source, /v-model:page="page"/)
    assert.match(source, /:items-per-page="pageSize"/)
    assert.match(source, /:total="total"/)
    assert.match(source, /moduleUrl\(`\/projects\/\$\{projectId\}/)
    const root = baseParse(parse(source).descriptor.template.content)
    assert.match(slot(elements(root, 'ProjectNavbar')[0], 'actions').loc.source, /@click="refresh"/)
  }
})

for (const accepted of [false, true]) {
  test(`member removal ${accepted ? 'continues after confirmation' : 'cancellation makes no request or retry key'}`, async () => {
    const source = read('members')
    const handler = source.slice(source.indexOf('async function write('), source.indexOf('async function refresh('))
    const requests = []
    const state = {
      confirm: async options => { assert.equal(options.tone, 'danger'); return accepted },
      userNames: { value: new Map([['sample', '标记成员']]) },
      saving: { value: false }, operationKey: { value: '' }, showAdd: { value: false },
      uid: { value: '' }, error: { value: '' }, projectId: { value: '257' },
      crypto: { randomUUID: () => 'sample-key' }, moduleUrl: path => path,
      $fetch: async (url, options) => { requests.push({ url, options }) }, refresh: async () => {}
    }
    vm.createContext(state)
    vm.runInContext(ts.transpile(handler + '\nthis.handler = write', { target: ts.ScriptTarget.ES2022 }), state)
    await state.handler('remove', 'sample')
    assert.equal(requests.length, accepted ? 1 : 0)
    assert.equal(state.saving.value, false)
    assert.equal(state.operationKey.value, '')
    if (accepted) {
      assert.equal(requests[0].options.method, 'DELETE')
      assert.equal(requests[0].options.body.uid, 'sample')
    }
  })
}
