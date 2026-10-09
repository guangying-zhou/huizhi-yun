import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { ref, reactive, computed, watch } from 'vue'
import '../shared/utils/consoleMutationIntent.ts'

async function editor() {
  const file = new URL('../app/components/DirectoryProjectEditor.vue', import.meta.url).pathname
  const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
  const result = await build({ stdin: { contents: compileScript(descriptor, { id: file }).content, loader: 'ts', resolveDir: new URL('../app/components/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'], plugins: [{ name: 'empty-sfc', setup(builder) {
    builder.onLoad({ filter: /\.vue$/ }, () => ({ contents: 'export default {}', loader: 'js' }))
  } }] })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  return module.exports.default
}

test('shared project editor gates writes, diffs fields, keeps stable retries, confirms delete and separates refresh failure', async () => {
  const state = { status: 0, confirmed: false, refreshFail: false, total: 1, items: [{ uid: 'U1', role: 'member' }], calls: [], toasts: [], confirmations: [], denied: [] }
  const mocks = { ref, reactive, computed, watch,
    useToast: () => ({ add: value => state.toasts.push(value) }),
    useConfirm: () => ({ confirm: async (value) => {
      state.confirmations.push(value)
      return state.confirmed
    } }),
    $fetch: async (path, options) => {
      state.calls.push({ path, ...options })
      if (state.status)
        throw Object.assign(Error('test'), { statusCode: state.status })
      return { code: 0, data: { items: state.items, total: state.total } }
    }
  }
  const previous = Object.fromEntries(Object.keys(mocks).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, mocks)
  try {
    const component = await editor()
    const props = { apiPath: '/enterprise/api/directory/projects', projects: [], departments: [], canEdit: true, refresh: async () => {
      if (state.refreshFail)
        throw Error('refresh')
    } }
    const setup = () => component.setup(props, { expose: () => {}, emit: (_, status) => state.denied.push(status) })
    const controller = setup()
    controller.openCreateProject()
    controller.projectForm.projectCode = 'P1'
    controller.projectForm.name = 'Project'
    state.status = 503
    await controller.submitProject()
    assert.equal(controller.projectModalOpen.value, true)
    assert.equal(controller.projectForm.name, 'Project')
    assert.equal(controller.locked.value, true)
    const first = state.calls.at(-1)
    controller.projectForm.name = 'Changed during uncertainty'
    await controller.submitProject()
    assert.deepEqual(state.calls.at(-1), first)
    state.status = 0
    state.refreshFail = true
    await controller.retry()
    assert.deepEqual(state.calls.at(-1), first, 'retry must use original payload and key')
    assert.equal(controller.projectModalOpen.value, false)
    assert.ok(state.toasts.some(item => item.title === '已保存，刷新失败'))
    const count = state.calls.length
    await controller.retry()
    assert.equal(state.calls.length, count)
    state.refreshFail = false
    const project = { projectCode: 'P1', name: 'Project', parentId: 'OutsidePage', isGroup: 0, isTemplate: 0, status: 1, deptCode: 'D1', leaderUid: null, ownerUid: null, repoUrl: null, description: null }
    controller.openEditProject(project)
    assert.ok(controller.parentProjectOptions.value.some(item => item.value === 'OutsidePage'))
    assert.ok(controller.departmentOptions.value.some(item => item.value === 'D1'))
    controller.projectForm.name = 'New'
    await controller.submitProject()
    assert.equal(state.calls.at(-1).method, 'PATCH')
    assert.deepEqual(state.calls.at(-1).body, { name: 'New' })
    const beforeDelete = state.calls.length
    await controller.deleteProject(project)
    assert.equal(state.calls.length, beforeDelete)
    assert.deepEqual(state.confirmations.at(-1), { title: '删除项目', message: '确认删除项目「Project」？删除后不可恢复。', tone: 'danger' })
    state.confirmed = true
    state.status = 503
    await controller.deleteProject(project)
    const failedDelete = state.calls.at(-1)
    state.status = 0
    await controller.retry()
    assert.deepEqual(state.calls.at(-1), failedDelete)
    await controller.loadMembers(project)
    assert.deepEqual(state.calls.at(-1).query, { projectCode: 'P1', page: 1, pageSize: 100, status: 'active' })
    assert.equal(controller.membersReady.value, true)
    controller.editableMembersText.value = 'U2:admin'
    state.confirmed = false
    const beforeSave = state.calls.length
    await controller.saveMembers()
    assert.equal(state.calls.length, beforeSave)
    assert.equal(state.confirmations.at(-1).tone, 'warning')
    assert.match(state.confirmations.at(-1).message, /Project.*将以当前列表替换全部成员/)
    state.confirmed = true
    state.status = 503
    await controller.saveMembers()
    const failedReplace = state.calls.at(-1)
    assert.deepEqual(failedReplace.body, { projectCode: 'P1', members: [{ uid: 'U2', role: 'admin' }] })
    assert.equal(controller.editableMembersText.value, 'U2:admin')
    assert.deepEqual(controller.members.value, [{ uid: 'U1', role: 'member' }])
    state.status = 0
    await controller.retry()
    assert.deepEqual(state.calls.at(-1), failedReplace)
    assert.equal(controller.isMembersModalOpen.value, false)
    await controller.loadMembers(project)
    controller.editableMembersText.value = ''
    await controller.saveMembers()
    assert.deepEqual(state.calls.at(-1).body.members, [], 'empty replacement still requires warning confirmation')
    for (const [total] of [[101, state.items], [2, state.items]]) {
      state.total = total
      await controller.loadMembers(project)
      const count = state.calls.length
      await controller.saveMembers()
      assert.equal(controller.membersReady.value, false)
      assert.equal(state.calls.length, count, 'partial reads cannot replace members')
    }
    state.total = 1
    state.status = 503
    await controller.loadMembers(project)
    const countAfterFailedRead = state.calls.length
    await controller.saveMembers()
    assert.equal(state.calls.length, countAfterFailedRead)
    state.status = 0
    await controller.loadMembers(project)
    for (const input of ['U1:root', 'U1:member\nU1:admin', 'U1:member:extra']) {
      controller.editableMembersText.value = input
      const count = state.calls.length
      await controller.saveMembers()
      assert.equal(state.calls.length, count)
    }
    props.canEdit = false
    const beforeDenied = state.calls.length
    await controller.deleteProject(project)
    await controller.submitProject()
    await controller.saveMembers()
    assert.equal(state.calls.length, beforeDenied)
    await controller.loadMembers(project)
    assert.equal(controller.members.value.length, 1, 'Console viewers retain member reads')
    props.canEdit = true
    state.status = 403
    await controller.deleteProject(project)
    assert.deepEqual(state.denied, [403])
  } finally {
    Object.assign(globalThis, previous)
  }
})
