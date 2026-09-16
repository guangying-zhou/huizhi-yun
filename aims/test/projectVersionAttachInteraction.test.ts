import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('project version attachment guards duplicates and rejects mismatched receipts', async () => {
  const source = readFileSync(new URL('../app/pages/projects/[id]/releases.vue', import.meta.url), 'utf8')
  const fn = source.slice(source.indexOf('async function attachItems()'), source.indexOf('\nfunction formatDate'))
  let resolve: (value: unknown) => void = () => {}
  let requests = 0
  const state = {
    selectedRelease: { value: { id: 7 } }, canAttachItems: { value: true },
    attachingItems: { value: false }, attachForm: { workItemIds: [9], featureId: null },
    attachError: { value: '' }, showAttachModal: { value: true },
    projectApiPath: (path: string) => path,
    $fetch: async () => {
      requests++
      return new Promise((done) => {
        resolve = done
      })
    },
    openRelease: async () => {}, loadAll: async () => {}, toast: { add: () => {} },
    errorMessage: (error: Error) => error.message
  }
  const execute = runInNewContext(ts.transpileModule(`${fn}\nattachItems`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, state)
  const first = execute()
  await execute()
  assert.equal(requests, 1)
  resolve({ code: 0, data: { version_id: 8 } })
  await first
  assert.equal(state.showAttachModal.value, true)
  assert.match(state.attachError.value, /回执无效/)
  assert.equal(state.attachingItems.value, false)
  state.canAttachItems.value = false
  await execute()
  assert.equal(requests, 1)
})

test('attachment retains selection on service failure and freezes the submitted version', async () => {
  const source = readFileSync(new URL('../app/pages/projects/[id]/releases.vue', import.meta.url), 'utf8')
  const fn = source.slice(source.indexOf('async function attachItems()'), source.indexOf('\nfunction formatDate'))
  let finish: (value: unknown) => void = () => {}
  let attempts = 0
  let opened = 0
  let refreshed = 0
  const requests: { path: string, ids: number[] }[] = []
  const state = {
    selectedRelease: { value: { id: 7 } }, canAttachItems: { value: true },
    attachingItems: { value: false }, attachForm: { workItemIds: [9], featureId: null },
    attachError: { value: '' }, showAttachModal: { value: true },
    projectApiPath: (path: string) => path,
    $fetch: async (path: string, options: { body: { work_item_ids: number[] } }) => {
      requests.push({ path, ids: options.body.work_item_ids })
      attempts++
      if (attempts === 1) throw new Error('Service unavailable')
      return new Promise((resolve) => {
        finish = resolve
      })
    },
    openRelease: async () => { opened++ },
    loadAll: async () => { refreshed++ },
    toast: { add: () => {} }, errorMessage: (error: Error) => error.message
  }
  const execute = runInNewContext(ts.transpileModule(`${fn}\nattachItems`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, state)
  await execute()
  assert.equal(state.showAttachModal.value, true)
  assert.deepEqual(state.attachForm.workItemIds, [9])
  assert.match(state.attachError.value, /Service unavailable/)
  const retry = execute()
  state.selectedRelease.value = { id: 8 }
  state.attachForm.workItemIds.push(10)
  assert.equal(requests[1]?.path, '/releases/7/items')
  assert.equal(JSON.stringify(requests[1]?.ids), '[9]')
  finish({ code: 0, data: { version_id: 7, attached: 1 } })
  await retry
  assert.equal(state.showAttachModal.value, false)
  assert.equal(state.attachError.value, '')
  assert.equal(opened, 0)
  assert.equal(refreshed, 1)
  assert.equal(state.attachingItems.value, false)
})

test('late version detail cannot overwrite the latest selection', async () => {
  const source = readFileSync(new URL('../app/pages/projects/[id]/releases.vue', import.meta.url), 'utf8')
  const fn = source.slice(source.indexOf('let releaseDetailRequest = 0'), source.indexOf('\nasync function saveProduct'))
  const pending: ((value: unknown) => void)[] = []
  const state = {
    selectedRelease: { value: { id: 0 } }, detailLoading: { value: false },
    projectApiPath: (path: string) => path,
    $fetch: async () => new Promise((resolve) => { pending.push(resolve) }),
    toast: { add: () => {} }, errorMessage: (error: Error) => error.message
  }
  const open = runInNewContext(ts.transpileModule(`${fn}\nopenRelease`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, state)
  const first = open({ id: 7 })
  const second = open({ id: 8 })
  pending[0]?.({ code: 0, data: { id: 7 } })
  await first
  assert.equal(state.selectedRelease.value.id, 8)
  assert.equal(state.detailLoading.value, true)
  pending[1]?.({ code: 0, data: { id: 8 } })
  await second
  assert.equal(state.selectedRelease.value.id, 8)
  assert.equal(state.detailLoading.value, false)
})
