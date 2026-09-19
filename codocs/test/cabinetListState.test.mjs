import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { computed, nextTick, ref, watch } from 'vue'

test('cabinet setup paginates, surfaces list failures and discards old preview responses', async () => {
  const source = readFileSync(new URL('../app/pages/mydocs/cabinet.vue', import.meta.url), 'utf8')
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*useCodocsModule.*\n/m, '')
  const stops = []
  const user = ref('person-a')
  const calls = []
  const previewResolvers = new Map()
  let count = 41
  let malformed = false
  const fetch = async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/api/folders')) return { data: { items: [] } }
    if (url.endsWith('/preview')) return new Promise(resolve => previewResolvers.set(url, resolve))
    if (malformed) return { success: true, data: {} }
    const { page, pageSize } = options.query
    const start = (page - 1) * pageSize
    return { success: true, data: { total: count, page, pageSize, items: Array.from({ length: Math.max(0, Math.min(pageSize, count - start)) }, (_, i) => ({ uuid: `file-${start + i}`, original_name: 'file.txt', file_ext: 'txt' })) } }
  }
  const trackedWatch = (...args) => { const stop = watch(...args); stops.push(stop); return stop }
  const useAsyncData = async (_key, handler, options) => {
    const data = ref(null), pending = ref(false), error = ref(null)
    const refresh = async () => {
      pending.value = true
      try { data.value = await handler(); error.value = null } catch (e) { error.value = e } finally { pending.value = false }
    }
    await refresh()
    trackedWatch(options.watch, refresh)
    return { data, pending, error, refresh }
  }
  const env = {
    ref, computed, watch: trackedWatch, nextTick, useAsyncData, $fetch: fetch,
    useRequestFetch: () => fetch, useAuth: () => ({ user }),
    useToast: () => ({ add() {} }), useCodocsModule: () => ({ moduleUrl: path => `/codocs${path}`, cacheKey: key => `person-a:${key}` }),
    useResizablePanel: () => ({ panelWidth: ref(260), panelCollapsed: ref(false), onResizeStart() {}, showPanel() {} }),
    useDocumentPreviewBootstrap: () => ({ setPayload() {} }), definePageMeta() {}, usePageTitle() {}, navigateTo() {}
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  let state
  const settle = async () => { await nextTick(); await new Promise(resolve => setImmediate(resolve)); await nextTick() }
  try {
    state = await new AsyncFunction(...Object.keys(env), stripTypeScriptTypes(script) + '\nreturn { page, files, total, error, refresh, selectFile, previewFile, previewData, previewLoading };')(...Object.values(env))
    assert.equal(state.files.value.length, 20)
    assert.equal(state.total.value, 41)
    state.page.value = 3
    await settle()
    assert.equal(state.files.value.length, 1)
    assert.deepEqual(calls.filter(call => call.url.endsWith('/api/cabinet')).at(-1).options.query, { owner_uid: 'person-a', page: 3, pageSize: 20 })
    count = 40
    await state.refresh()
    await settle()
    assert.equal(state.page.value, 2)
    assert.equal(state.files.value.length, 20)
    malformed = true
    await state.refresh()
    assert.ok(state.error.value)
    malformed = false
    await state.refresh()
    assert.equal(state.error.value, null)

    const a = state.selectFile({ uuid: 'a', original_name: 'A.txt', file_ext: 'txt' })
    const b = state.selectFile({ uuid: 'b', original_name: 'B.txt', file_ext: 'txt' })
    previewResolvers.get('/codocs/api/cabinet/b/preview')({ success: true, data: { content: 'B' } })
    await b
    previewResolvers.get('/codocs/api/cabinet/a/preview')({ success: true, data: { content: 'A' } })
    await a
    assert.equal(state.previewData.value.content, 'B')
    const pending = state.selectFile({ uuid: 'c', original_name: 'C.txt', file_ext: 'txt' })
    user.value = 'person-b'
    await settle()
    assert.equal(state.page.value, 1)
    assert.equal(state.previewFile.value, null)
    previewResolvers.get('/codocs/api/cabinet/c/preview')({ success: true, data: { content: 'old session' } })
    await pending
    assert.equal(state.previewData.value, null)
    assert.equal(state.previewLoading.value, false)
  } finally {
    for (const stop of stops) stop()
  }
})
