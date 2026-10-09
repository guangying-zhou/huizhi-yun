import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { ref, computed, watch } from 'vue'

test('the real selector excludes reserved candidates and refuses to emit them while displaying a historical owner', async () => {
  const file = new URL('../app/components/UserTreeSelector.vue', import.meta.url).pathname
  const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
  const result = await build({ stdin: { contents: compileScript(descriptor, { id: file }).content, loader: 'ts', resolveDir: new URL('../app/components/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'], plugins: [{ name: 'form-context', setup(builder) {
    builder.onResolve({ filter: /^#ui\/composables\/useFormField$/ }, () => ({ path: 'form-context', namespace: 'test' }))
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const inputIdInjectionKey = Symbol(); export const useFormField = () => ({ id: "owner", ariaAttrs: {} })' }))
  } }] })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  const mocks = { ref, computed, watch, onMounted: () => {}, provide: () => {}, useId: () => 'owner', useRuntimeConfig: () => ({ public: { appCode: 'enterprise' } }) }
  const previous = Object.fromEntries(Object.keys(mocks).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, mocks)
  try {
    const events = []
    const props = { modelValue: ['system:unassigned'], users: [], selectionMode: 'multiple', excludeUids: [], hideCommittees: false, showRootDept: false, scopeDeptCode: '' }
    const selector = module.exports.default.setup(props, { expose: () => {}, emit: (event, value) => events.push({ event, value }) })
    const reserved = ['system:unassigned', 'System:Unassigned', 'system', 'SYSTEM:x', 'client:finance.runtime', ' client:x ']
    selector.allUsers.value = [...reserved.map(uid => ({ uid, realName: 'must not be offered', status: 1 })), { uid: 'Active', realName: '有效成员', status: 1 }, { uid: 'disabled', status: 0 }, { uid: 'deleted', status: -1 }, { uid: 'unknown' }]
    // Execute the actual Console sharing projection, then feed its output into the real selector.
    const route = readFileSync(new URL('../../console/server/api/v1/console/service/directory/users/index.get.ts', import.meta.url), 'utf8')
    const projection = route.slice(route.indexOf('function sharingUser('), route.indexOf('function sharingDepartment('))
    const compiled = await build({ stdin: { contents: `${projection}\nexport { sharingUser }`, loader: 'ts' }, platform: 'node', format: 'cjs', write: false })
    const projectionModule = { exports: {} }
    new Function('module', 'exports', compiled.outputFiles[0].text)(projectionModule, projectionModule.exports)
    const projected = ['colleague', 'inactive', 'unknown'].map((uid, index) => projectionModule.exports.sharingUser({ uid, realName: '同事', deptCode: 'qa-dept', status: [1, 0, undefined][index], email: 'must-not-leak', mobile: 'must-not-leak' }))
    assert.equal(projected[0].status, 1)
    assert.equal(Object.hasOwn(projected[0], 'email'), false)
    assert.equal(Object.hasOwn(projected[0], 'mobile'), false)
    const originalUsers = selector.allUsers.value
    selector.departments.value = [{ deptCode: 'qa-root', name: '合成公司', children: [{ deptCode: 'qa-dept', name: '合成部门', children: [] }] }]
    selector.allUsers.value = projected
    assert.equal(selector.displayTree.value[0].children[0].uid, 'colleague')
    assert.deepEqual([...selector.availableUserMap.value.keys()], ['colleague'])
    selector.keyword.value = 'colleague'
    assert.match(JSON.stringify(selector.displayTree.value), /colleague/)
    selector.keyword.value = '同事'
    assert.match(JSON.stringify(selector.displayTree.value), /colleague/)
    assert.doesNotMatch(JSON.stringify(selector.displayTree.value), /inactive|unknown/)
    selector.keyword.value = ''
    selector.allUsers.value = originalUsers
    selector.departments.value = []
    assert.deepEqual([...selector.availableUserMap.value.keys()], ['Active'])
    assert.equal(selector.selectedUserObjects.value[0].realName, '未分配')
    selector.emitByUids([...reserved, 'disabled', 'deleted', 'unknown', 'Active'])
    assert.deepEqual(events.find(event => event.event === 'update:modelValue').value, ['Active'])
    assert.deepEqual(events.find(event => event.event === 'update:users').value.map(user => user.uid), ['Active'])
    events.length = 0
    selector.emitByUids(reserved)
    assert.deepEqual(events.find(event => event.event === 'update:modelValue').value, [])
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
})
