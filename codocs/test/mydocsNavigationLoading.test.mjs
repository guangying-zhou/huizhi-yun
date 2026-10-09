import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../app/pages/mydocs/index.vue', import.meta.url), 'utf8')
const section = page.slice(page.indexOf('const { data: rootFolders'), page.indexOf('async function loadChild'))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

async function loadPage() {
  const requests = []
  const ref = value => ({ value })
  const useAsyncData = (key, handler, options) => {
    assert.equal(options.lazy, true, `${key} must not suspend client navigation`)
    assert.equal(options.immediate, true)
    const state = { data: ref(null), pending: ref(true), error: ref(null), refresh: async () => {} }
    const request = new Promise((resolve, reject) => requests.push({ key, resolve, reject }))
    const finished = request.then((value) => {
      state.data.value = value
    }, (error) => {
      state.error.value = error
    })
      .finally(() => { state.pending.value = false })
    requests.at(-1).finished = finished
    return Promise.resolve(state)
  }
  const setup = new AsyncFunction('env', `with (env) { ${section}; return { rootFolders, rootDocuments, rootFolderError, rootDocumentError, loading }; }`)
  const state = await setup({
    useAsyncData, cacheKey: x => x, user: ref('fixture'), rootFolderPage: ref(1), rootDocumentPage: ref(1),
    fetchFolderPage() {}, fetchDocumentPage() {}, computed: fn => ({ get value() { return fn() } })
  })
  return { state, requests }
}

test('mydocs navigation exposes its page while both independent directory reads are still pending', async () => {
  const { state, requests } = await loadPage()
  assert.equal(requests.length, 2)
  assert.equal(state.loading.value, true)
  assert.equal(state.rootFolders.value, null)
  requests[1].resolve({ items: [], total: 0, page: 1, pageSize: 20 })
  await requests[1].finished
  assert.equal(state.loading.value, true)
  requests[0].resolve({ items: [], total: 0, page: 1, pageSize: 20, parentChain: [] })
  await requests[0].finished
  assert.equal(state.loading.value, false)
  assert.equal(state.rootFolderError.value, null)
  assert.equal(state.rootDocuments.value.total, 0)
})

test('a rejected directory read ends loading and is not displayed as an empty library', async () => {
  const { state, requests } = await loadPage()
  requests[0].reject(Object.assign(new Error('fixture directory denied'), { statusCode: 403 }))
  requests[1].resolve({ items: [], total: 0, page: 1, pageSize: 20 })
  await Promise.all(requests.map(request => request.finished))
  assert.equal(state.loading.value, false)
  assert.equal(state.rootFolderError.value.statusCode, 403)
  assert.match(page, /role="status"\s+aria-live="polite"/)
  assert.match(page, /文档目录加载失败，请重试/)
  assert.match(page, /!rootFolderError && !rootDocumentError && treeItems.length === 0/)
  assert.match(page, /Promise\.all\(\[refreshFolders\(\),\s*refreshDocs\(\)\]\)/)
})
