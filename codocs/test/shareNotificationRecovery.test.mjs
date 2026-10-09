import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { ref, computed } from 'vue'

test('real share modal refreshes committed ACL on notification 503, retains failed payload and retries original key', async () => {
  const file = new URL('../app/components/document/ShareDocumentModal.vue', import.meta.url).pathname
  const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
  const compiled = await build({ stdin: { contents: compileScript(descriptor, { id: file }).content, loader: 'ts', resolveDir: new URL('../app/components/document/', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'], plugins: [{ name: 'module-context', setup(builder) {
    builder.onResolve({ filter: /useCodocsModule$/ }, () => ({ path: 'module-context', namespace: 'test' }))
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const useCodocsModule = () => ({ moduleUrl: path => `/codocs${path}`, cacheKey: key => `tenant:session:${key}` })' }))
  } }] })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  const calls = [], toasts = []
  let failed = true
  const mocks = {
    ref, computed, watch: () => {}, useAuth: () => ({ user: ref('owner') }), useToast: () => ({ add: value => toasts.push(value) }),
    $fetch: async (path, options) => {
      calls.push({ path, options })
      if (options?.method === 'POST' && options.body.sharedToUid === 'pending' && failed) {
        throw { statusCode: 503, data: { message: '共享已保存，通知尚未完成，请使用相同请求重试', data: { code: 'document_share_notification_pending', sharedPersisted: true } } }
      }
      if (options?.method === 'POST') return { code: 0, data: {} }
      return { data: [{ id: 7, shared_to_uid: 'pending', permission: 'write' }] }
    }
  }
  const old = Object.fromEntries(Object.keys(mocks).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, mocks)
  try {
    const modal = module.exports.default.setup({ open: true, docId: 'doc-a', docTitle: 'Synthetic' }, { expose: () => {}, emit: () => {} })
    modal.usersToAdd.value = [{ uid: 'success', realName: '甲' }, { uid: 'pending', realName: '乙' }]
    modal.usersToAddUids.value = ['success', 'pending']
    modal.isWritePermission.value = true
    modal.shareMessage.value = 'keep original intent'
    await modal.shareOrRemind()
    assert.equal(modal.loading.value, false)
    assert.equal(modal.shares.value[0].shared_to_uid, 'pending')
    assert.deepEqual(modal.usersToAddUids.value, ['pending'])
    assert.equal(modal.shareMessage.value, 'keep original intent')
    assert.equal(calls.filter(call => !call.options?.method).length, 1)
    const first = calls.find(call => call.options?.body.sharedToUid === 'pending')
    failed = false
    await modal.shareOrRemind()
    const attempts = calls.filter(call => call.options?.body.sharedToUid === 'pending')
    assert.equal(attempts.length, 2)
    assert.equal(attempts[1].options.headers['Idempotency-Key'], first.options.headers['Idempotency-Key'])
    assert.deepEqual(attempts[1].options.body, first.options.body)
    assert.equal(calls.filter(call => call.options?.body.sharedToUid === 'success').length, 1)
    assert.deepEqual(modal.usersToAddUids.value, [])
    assert.equal(modal.shareMessage.value, '')
    assert.equal(modal.loading.value, false)
    assert.equal(calls.filter(call => !call.options?.method).length, 2)
    assert.ok(toasts.some(toast => toast.color === 'success' && /已共享/.test(toast.title) && /企业微信通知未送达/.test(toast.description)))
    assert.equal(toasts.some(toast => toast.color === 'error'), false)
  } finally {
    for (const [key, value] of Object.entries(old)) value === undefined ? delete globalThis[key] : globalThis[key] = value
  }
})
