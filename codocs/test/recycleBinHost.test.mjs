import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('useRecycleBin uses the Codocs module boundary and preserves standalone fallbacks', async () => {
  const root = resolve(import.meta.dirname, '..')
  const fetchCalls = []
  const toasts = []
  const oldFetch = globalThis.$fetch
  const oldToast = globalThis.useToast
  const oldRuntimeConfig = globalThis.useRuntimeConfig
  const oldModule = globalThis.__recycleModule
  globalThis.__recycleModule = { hosted: true, moduleUrl: path => `/codocs${path}` }
  globalThis.useToast = () => ({ add: toast => toasts.push(toast) })
  globalThis.useRuntimeConfig = () => ({ public: { recycleDays: 30 } })

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/layer/useCodocsModule')) source = 'export const useCodocsModule=()=>globalThis.__recycleModule'
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
      let candidate
      if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
      return next(specifier, context)
    }
  })

  try {
    const { useRecycleBin } = await import('../app/composables/useRecycleBin.ts')
    for (const hosted of [true, false]) {
      fetchCalls.length = 0
      toasts.length = 0
      globalThis.__recycleModule = { hosted, moduleUrl: path => hosted ? `/codocs${path}` : path, cacheKey: key => `${hosted ? 'enterprise' : 'codocs'}:person-a:${key}` }
      globalThis.$fetch = async (url, options) => {
        fetchCalls.push({ url, options })
        if (url.endsWith('/check-name')) return { success: true, data: { exists: false } }
        if (url.endsWith('/trash')) return { success: true, data: { items: [] } }
        return { success: true }
      }
      const recycle = useRecycleBin()
      assert.equal(await recycle.checkNameConflict({ title: 'Draft', doc_type: 'private', folder_id: null }), false)
      assert.equal(await recycle.fetchTrashDocuments({ type: 'private' }).then(items => items.length), 0)
      assert.equal(await recycle.restoreDocument('doc-1'), true)
      assert.deepEqual(fetchCalls.map(call => call.url), [
        hosted ? '/codocs/api/documents/check-name' : '/api/documents/check-name',
        hosted ? '/codocs/api/documents/trash' : '/api/documents/trash',
        hosted ? '/codocs/api/documents/doc-1/restore' : '/api/documents/doc-1/restore'
      ])

      const check = fetchCalls[0]
      assert.equal(check.options.query.folder_id, 'null')
      assert.equal(fetchCalls[1].options.query.type, 'private')
      assert.match(fetchCalls[2].options.headers['Idempotency-Key'], /^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/)
      assert.equal(toasts.at(-1).color, 'success')

      globalThis.$fetch = async url => {
        if (url.endsWith('/check-name')) return { success: true, data: { exists: true } }
        if (url.endsWith('/trash')) return { success: true, data: { items: [{ uuid: 'doc-1' }] } }
        throw new Error('restore failed')
      }
      assert.equal(await recycle.checkNameConflict({ title: 'Draft', doc_type: 'private' }), true)
      assert.deepEqual(await recycle.fetchTrashDocuments({}), [{ uuid: 'doc-1' }])
      assert.equal(await recycle.restoreDocument('doc-2', 'Recovered'), false)
      assert.equal(toasts.at(-1).color, 'error')

      const keys = []
      globalThis.$fetch = async (_url, options) => {
        keys.push(options.headers['Idempotency-Key'])
        if (keys.length === 1) throw new Error('response lost')
        return { success: true }
      }
      assert.equal(await recycle.restoreDocument('doc-retry'), false)
      assert.equal(await recycle.restoreDocument('doc-retry'), true)
      assert.equal(keys[0], keys[1])
      assert.equal(await recycle.restoreDocument('doc-retry'), true)
      assert.notEqual(keys[1], keys[2])

      globalThis.$fetch = async url => {
        if (url.endsWith('/check-name')) return { success: true, data: {} }
        return { success: true, data: {} }
      }
      if (hosted) {
        await assert.rejects(recycle.checkNameConflict({ title: 'Bad', doc_type: 'private' }))
        await assert.rejects(recycle.fetchTrashDocuments({}))
      } else {
        assert.equal(await recycle.checkNameConflict({ title: 'Bad', doc_type: 'private' }), false)
        assert.deepEqual(await recycle.fetchTrashDocuments({}), [])
      }
    }
  } finally {
    hooks.deregister()
    globalThis.$fetch = oldFetch
    globalThis.useToast = oldToast
    globalThis.useRuntimeConfig = oldRuntimeConfig
    globalThis.__recycleModule = oldModule
  }
})
