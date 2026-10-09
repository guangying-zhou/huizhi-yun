import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { ref, computed, watch, effectScope } from 'vue'

const code = buildSync({ entryPoints: [new URL('../app/composables/useNotifications.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@vueuse/core'], define: { 'import.meta.client': 'false' } }).outputFiles[0]!.text

test('notification page state is separate from cursor state and rejects superseded/logout responses', async () => {
  const calls: { url: string, options: { signal: AbortSignal }, resolve: (value: unknown) => void }[] = [], scope = effectScope()
  const auth = { authenticated: ref(true), user: ref('alice'), tenant: ref('T1'), policyVersion: ref('P1') }
  const mocks = { ref, computed, watch, onScopeDispose: () => {}, useAuth: () => auth, useRuntimeConfig: () => ({ public: { appCode: 'enterprise' } }), $fetch: (url: string, options: { signal: AbortSignal }) => new Promise(resolve => calls.push({ url, options, resolve })) }
  const previous = Object.fromEntries(Object.keys(mocks).map(key => [key, (globalThis as unknown as Record<string, unknown>)[key]]))
  Object.assign(globalThis, mocks)
  try {
    const module = { exports: {} as typeof import('../app/composables/useNotifications') }
    new Function('require', 'module', 'exports', code)((name: string) => {
      assert.equal(name, '@vueuse/core')
      return { createSharedComposable: (fn: () => unknown) => fn }
    }, module, module.exports)
    const api = scope.run(() => module.exports.useNotifications())
    const legacy = api.loadNotifications({ cursor: '9', limit: 20 })
    calls[0].resolve({ code: 0, data: { items: [{ notificationId: 'legacy' }], nextCursor: '8' } })
    await legacy
    const first = api.loadNotificationPage({ status: 'unread', page: 2, pageSize: 20 })
    const second = api.loadNotificationPage({ status: 'all', page: 1, pageSize: 20 })
    assert.equal(calls[1].options.signal.aborted, true)
    calls[2].resolve({ code: 0, data: { items: [{ notificationId: 'page' }], total: 41, page: 1, pageSize: 20 } })
    await second
    calls[1].resolve({ code: 0, data: { items: [{ notificationId: 'STALE' }], total: 999, page: 2, pageSize: 20 } })
    await first
    assert.equal(api.pageTotal.value, 41)
    assert.equal(api.pageItems.value[0].notificationId, 'page')
    assert.equal(api.items.value[0].notificationId, 'legacy')
    assert.equal(api.nextCursor.value, '8')
    const pending = api.loadNotificationPage({ status: 'all', page: 2, pageSize: 20 })
    auth.authenticated.value = false
    assert.equal(calls[3].options.signal.aborted, true)
    calls[3].resolve({ code: 0, data: { items: [{ notificationId: 'SECRET' }], total: 41, page: 2, pageSize: 20 } })
    await pending
    assert.deepEqual(api.pageItems.value, [])
    assert.equal(api.pageTotal.value, 0)
    await api.loadNotificationPage({ status: 'all', page: 1, pageSize: 20 })
    assert.equal(calls.length, 4)
  } finally {
    scope.stop()
    Object.assign(globalThis, previous)
  }
})
