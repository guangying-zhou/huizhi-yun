import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { ref, reactive, computed, watch } from 'vue'
import { createConsoleMutationIntent } from '../shared/utils/consoleMutationIntent.ts'

async function editor() {
  const file = new URL('../app/components/DirectoryDepartmentEditor.vue', import.meta.url).pathname
  const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
  const result = await build({ stdin: { contents: compileScript(descriptor, { id: file }).content, loader: 'ts', resolveDir: new URL('../app/components/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'], loader: { '.vue': 'empty' } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  return module.exports.default
}

test('mutation intent preserves the exact key and payload across unknown retries and rejects overlapping changes', async () => {
  let keys = 0
  const intent = createConsoleMutationIntent('test', () => `test-key-${++keys}`)
  const request = { method: 'POST', path: '/departments', body: { name: 'A' } }
  const calls = []
  const send = async (input, key) => {
    calls.push({ input, key })
    throw Object.assign(Error('network'), { statusCode: 503 })
  }
  await assert.rejects(intent.submit(request, send))
  await assert.rejects(intent.submit({ ...request, body: { name: 'B' } }, send), /请先重试/)
  await assert.rejects(intent.submit(request, send))
  assert.equal(keys, 1)
  assert.deepEqual(calls[0], calls[1])
  assert.equal(await intent.submit(request, async () => {}), true)
  assert.equal(intent.pending, null)
  await intent.submit({ ...request, body: { name: 'B' } }, async () => {})
  assert.equal(keys, 2)
})

test('shared department editor gates writes, keeps drafts on failure, confirms deletes and separates successful writes from refresh errors', async () => {
  const state = { status: 0, confirmed: false, refreshFail: false, calls: [], toasts: [], confirmations: [], denied: [] }
  const mocks = { ref, reactive, computed, watch,
    useToast: () => ({ add: value => state.toasts.push(value) }),
    useConfirm: () => ({ confirm: async (value) => {
      state.confirmations.push(value)
      return state.confirmed
    } }),
    $fetch: async (path, options) => {
      state.calls.push({ path, ...options })
      if (state.status) throw Object.assign(Error('test'), { statusCode: state.status })
    }
  }
  const previous = Object.fromEntries(Object.keys(mocks).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, mocks)
  try {
    const component = await editor()
    const props = { apiPath: '/enterprise/api/directory/departments', departments: [], canEdit: true, refresh: async () => {
      if (state.refreshFail) throw Error('refresh')
    } }
    const setup = () => component.setup(props, { expose: () => {}, emit: (event, status) => {
      if (event === 'denied') state.denied.push(status)
    } })
    const controller = setup()
    controller.openCreateDepartment()
    controller.form.deptCode = 'D1'
    controller.form.name = 'Dept'
    state.status = 503
    await controller.submitDepartment()
    assert.equal(controller.modalOpen.value, true)
    assert.equal(controller.form.name, 'Dept')
    assert.equal(controller.locked.value, true)
    const first = state.calls.at(-1)
    state.status = 0
    state.refreshFail = true
    await controller.retry()
    assert.deepEqual(state.calls.at(-1), first)
    assert.equal(controller.modalOpen.value, false)
    assert.ok(state.toasts.some(item => item.title === '已保存，刷新失败'))
    assert.equal(state.toasts.at(-1).color, 'warning')
    const count = state.calls.length
    await controller.retry()
    assert.equal(state.calls.length, count, 'refresh failure must not re-submit successful mutation')
    state.refreshFail = false
    const dept = { deptCode: 'D1', name: 'Dept', parentId: null, orgType: 'department', deptCategory: null, managerId: null, leaderId: null, sortOrder: 100, description: null }
    controller.openEditDepartment(dept)
    controller.form.name = 'New'
    await controller.submitDepartment()
    assert.equal(state.calls.at(-1).method, 'PATCH')
    assert.deepEqual(state.calls.at(-1).body, { name: 'New' })
    const beforeDelete = state.calls.length
    await controller.deleteDepartment(dept)
    assert.equal(state.calls.length, beforeDelete)
    assert.deepEqual(state.confirmations.at(-1), { title: '删除部门', message: '确认删除部门「Dept」？删除后不可恢复。', tone: 'danger' })
    state.confirmed = true
    state.status = 503
    await controller.deleteDepartment(dept)
    const failedDelete = state.calls.at(-1)
    state.status = 0
    await controller.retry()
    assert.deepEqual(state.calls.at(-1), failedDelete)
    props.canEdit = false
    const beforeDenied = state.calls.length
    await controller.deleteDepartment(dept)
    await controller.submitDepartment()
    assert.equal(state.calls.length, beforeDenied)
    props.canEdit = true
    state.status = 403
    await controller.deleteDepartment(dept)
    assert.deepEqual(state.denied, [403])
  } finally { Object.assign(globalThis, previous) }
})
