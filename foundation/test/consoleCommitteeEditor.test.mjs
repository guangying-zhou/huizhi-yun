import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { ref, reactive, computed } from 'vue'
import { createConsoleMutationIntent } from '../shared/utils/consoleMutationIntent.ts'

async function editor() {
  const file = new URL('../app/components/DirectoryCommitteeEditor.vue', import.meta.url).pathname
  const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
  const result = await build({ stdin: { contents: compileScript(descriptor, { id: file }).content, loader: 'ts', resolveDir: new URL('../app/components/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'] })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  return module.exports.default
}

test('committee editor keeps exact retries, drafts, member roles and independent refresh errors across all six writes', async () => {
  const member = { uid: 'U1', displayName: '成员一', role: 'member' }
  const committee = { committeeCode: 'C1', name: '架构委员会', parentDeptCode: null, description: null, sortOrder: 100, status: 'active', memberCount: 1, leaderUid: null, managerUid: null }
  const state = { status: 0, readStatus: 0, refreshFail: false, confirmed: false, items: [member], total: 1, emptyLastPage: false, calls: [], toasts: [], confirmations: [], denied: [] }
  const mocks = { ref, reactive, computed, watch: () => {},
    useDebouncedSearch: () => ({ search: ref(''), debounced: ref(''), flush: () => {}, reset: () => {} }),
    useToast: () => ({ add: value => state.toasts.push(value) }),
    useConfirm: () => ({ confirm: async value => { state.confirmations.push(value); return state.confirmed } }),
    $fetch: async (path, options) => {
      state.calls.push({ path, ...options })
      const status = options.method ? state.status : state.readStatus
      if (status) throw Object.assign(Error('test'), { statusCode: status })
      return { code: 0, data: { items: state.emptyLastPage && options.query?.page > 1 ? [] : state.items, total: state.total } }
    }
  }
  const previous = Object.fromEntries(Object.keys(mocks).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, mocks)
  try {
    const component = await editor()
    const props = { apiPath: '/enterprise/api/directory/committees', committees: [committee], departments: [], canEdit: true, refresh: async () => { if (state.refreshFail) throw Error('refresh') } }
    const c = component.setup(props, { expose: () => {}, emit: (_, status) => state.denied.push(status) })
    const writes = () => state.calls.filter(call => call.method)
    c.openCreateCommittee()
    await c.submitCommittee()
    assert.equal(writes().length, 0)
    c.form.committeeCode = 'C1'
    c.form.name = committee.name
    state.status = 503
    await c.submitCommittee()
    assert.equal(c.committeeModalOpen.value, true)
    assert.equal(c.form.name, committee.name)
    const first = writes().at(-1)
    c.form.name = 'Changed'
    await c.submitCommittee()
    assert.equal(writes().length, 1)
    state.status = 0
    state.refreshFail = true
    await c.retry()
    assert.deepEqual(writes().at(-1), first)
    assert.equal(c.committeeModalOpen.value, false)
    assert.ok(state.toasts.some(toast => toast.title === '已保存，刷新失败'))
    const count = writes().length
    await c.retry()
    assert.equal(writes().length, count)
    state.refreshFail = false
    c.openEditCommittee(committee)
    c.form.description = 'New'
    await c.submitCommittee()
    assert.deepEqual(writes().at(-1).body, { description: 'New' })
    const beforeDelete = writes().length
    await c.deleteCommittee(committee)
    assert.equal(writes().length, beforeDelete)
    assert.deepEqual(state.confirmations.at(-1), { title: '删除委员会', message: '确认删除委员会「架构委员会」？请先移除全部成员；删除后不可恢复。', tone: 'danger' })
    state.confirmed = true
    state.status = 503
    await c.deleteCommittee(committee)
    const failedDelete = writes().at(-1)
    state.status = 0
    await c.retry()
    assert.deepEqual(writes().at(-1), failedDelete)
    await c.openMembers(committee)
    c.newMemberUids.value = ['U2']
    c.newMemberUsers.value = [{ uid: 'U2', realName: '成员二' }]
    c.newMemberRole.value = 'observer'
    state.status = 400
    await c.addMembers()
    assert.deepEqual(c.newMemberUids.value, ['U2'])
    assert.equal(c.newMemberUsers.value[0].uid, 'U2')
    assert.deepEqual(c.members.value, [member])
    state.status = 503
    await c.addMembers()
    const failedAdd = writes().at(-1)
    assert.deepEqual(failedAdd.body, { members: [{ uid: 'U2', role: 'observer' }] })
    state.status = 0
    state.refreshFail = true
    await c.retry()
    assert.deepEqual(writes().at(-1), failedAdd)
    assert.deepEqual(c.newMemberUids.value, [])
    const afterAdd = writes().length
    await c.refreshMembers()
    assert.equal(writes().length, afterAdd)
    state.refreshFail = false
    state.status = 400
    const revision = c.roleRevision.value
    await c.updateMemberRole(member, 'leader')
    assert.equal(c.members.value[0].role, 'member', 'failed role change must not mutate displayed server role')
    assert.equal(c.roleRevision.value, revision + 1, 'controlled role select resets after failed write')
    assert.match(c.membersError.value, /操作失败/)
    state.status = 503
    await c.updateMemberRole(member, 'leader')
    const failedRole = writes().at(-1)
    state.status = 0
    state.items = [{ ...member, role: 'leader' }]
    props.committees = [{ ...committee, leaderUid: 'U1', leaderName: '成员一' }]
    await c.retry()
    assert.deepEqual(writes().at(-1), failedRole)
    assert.equal(c.members.value[0].role, 'leader')
    assert.equal(c.selectedCommittee.value.leaderUid, 'U1')
    state.confirmed = false
    const beforeRemove = writes().length
    await c.removeMember(member)
    assert.equal(writes().length, beforeRemove)
    assert.deepEqual(state.confirmations.at(-1), { title: '移除委员会成员', message: '确认将「成员一」从委员会「架构委员会」移除？', tone: 'warning' })
    state.confirmed = true
    state.status = 503
    await c.removeMember(member)
    const failedRemove = writes().at(-1)
    assert.equal(c.members.value[0].uid, 'U1')
    state.status = 0
    state.emptyLastPage = true
    state.total = 10
    c.memberPage.value = 2
    await c.retry()
    assert.deepEqual(writes().at(-1), failedRemove)
    assert.equal(c.memberPage.value, 1, 'empty last page moves back after server read')
    assert.equal(state.calls.at(-1).query.page, 1)
    state.readStatus = 503
    await c.refreshMembers()
    assert.equal(c.memberReadFailed.value, true)
    assert.deepEqual(c.members.value, [])
    c.newMemberUids.value = ['U2']
    const afterReadFailure = writes().length
    await c.addMembers()
    assert.equal(writes().length, afterReadFailure)
    state.readStatus = 0
    await c.refreshMembers()
    props.canEdit = false
    const beforeDenied = writes().length
    await c.submitCommittee()
    await c.deleteCommittee(committee)
    await c.addMembers()
    await c.updateMemberRole(member, 'manager')
    await c.removeMember(member)
    assert.equal(writes().length, beforeDenied)
    await c.openMembers(committee)
    assert.ok(c.members.value.length, 'view-only readers retain member access')
    props.canEdit = true
    state.status = 403
    await c.deleteCommittee(committee)
    assert.deepEqual(state.denied, [403])
  } finally { Object.assign(globalThis, previous) }
})
