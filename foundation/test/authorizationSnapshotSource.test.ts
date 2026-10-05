import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { computed, ref, watch } from 'vue'
import {
  AUTHORIZATION_SNAPSHOT_INVALID_RESPONSE,
  AuthorizationSnapshotResponseError,
  parseAuthorizationSnapshotResponse,
  resolveAuthorizationSnapshotSource,
  routeAuthorizationApp
} from '../shared/utils/authorizationSnapshotSource'

describe('authorization snapshot source', () => {
  test('standalone applications keep their own root endpoint regardless of route meta', () => {
    for (const appCode of ['aims', 'assets', 'codocs', 'console', undefined]) {
      assert.deepEqual(resolveAuthorizationSnapshotSource({ appCode }, { authorizationApp: 'assets' }), {
        key: '', url: '/api/auth/permissions', expectedApp: null
      })
    }
  })

  test('Host pages request the snapshot of the module that owns the route', () => {
    assert.deepEqual(resolveAuthorizationSnapshotSource({ appCode: 'enterprise' }, { authorizationApp: 'aims' }), {
      key: 'aims', url: '/enterprise/api/auth/permissions?app=aims', expectedApp: 'aims'
    })
    assert.equal(resolveAuthorizationSnapshotSource({ appCode: 'enterprise' }, { authorizationApp: 'assets' })?.key, 'assets')
    // A Host page without an owning module has no module snapshot at all.
    assert.equal(resolveAuthorizationSnapshotSource({ appCode: 'enterprise' }, {}), null)
    assert.equal(resolveAuthorizationSnapshotSource({ appCode: 'enterprise' }, undefined), null)
  })

  test('only a well-formed module code from route meta is accepted', () => {
    for (const value of ['../aims', 'AIMS', 'aims?x=1', '', 1, null, ['aims']]) {
      assert.equal(routeAuthorizationApp({ authorizationApp: value }), null)
    }
    // Legacy meta keys are not a source: only the build-time authorizationApp.
    assert.equal(routeAuthorizationApp({ logicalModule: 'aims', navigationOwner: 'console' }), null)
  })
})

describe('authorization snapshot response validation', () => {
  const valid = { code: 0, data: { appCode: 'aims', uid: 'u1', roles: ['r1'], resources: { timesheet: ['view', 'submit'] }, actionPolicies: {} } }

  test('accepts the JSON envelope and normalizes it', () => {
    const parsed = parseAuthorizationSnapshotResponse(valid, 'aims')
    assert.deepEqual(parsed.resources, { timesheet: ['view', 'submit'] })
    assert.equal(parsed.uid, 'u1')
    assert.deepEqual(parsed.roles, ['r1'])
    assert.deepEqual(parsed.availableRoles, [])
    // Standalone endpoints do not echo appCode.
    const standalone = parseAuthorizationSnapshotResponse({ code: 0, data: { uid: 'u1', roles: [], resources: {} } }, null)
    assert.deepEqual(standalone.resources, {})
  })

  test('HTML, wrong shapes, non-zero codes and a different module are errors, never an empty snapshot', () => {
    const invalid: unknown[] = [
      '<!DOCTYPE html><html><body><div id="__nuxt"></div></body></html>',
      '',
      null,
      [],
      {},
      { code: 1, data: valid.data },
      { code: 0 },
      { code: 0, data: { resources: [] } },
      { code: 0, data: { appCode: 'aims', resources: { timesheet: 'submit' } } },
      { code: 0, data: { appCode: 'aims', resources: {}, actionPolicies: [] } }
    ]
    for (const response of invalid) {
      assert.throws(() => parseAuthorizationSnapshotResponse(response, 'aims'), (error: unknown) =>
        error instanceof AuthorizationSnapshotResponseError && error.code === AUTHORIZATION_SNAPSHOT_INVALID_RESPONSE)
    }
    assert.throws(() => parseAuthorizationSnapshotResponse({ code: 0, data: { ...valid.data, appCode: 'assets' } }, 'aims'), AuthorizationSnapshotResponseError)
    assert.throws(() => parseAuthorizationSnapshotResponse({ code: 0, data: { resources: {} } }, 'aims'), AuthorizationSnapshotResponseError)
  })
})

describe('useAuthorization per-module state in the Enterprise Host', () => {
  test('route module selects the snapshot, modules never leak, and a non-JSON response is an error state', async () => {
    const requests: string[] = []
    const currentRoute = ref<{ meta: Record<string, unknown> }>({ meta: { authorizationApp: 'aims' } })
    const responses: Record<string, unknown> = {
      '/enterprise/api/auth/permissions?app=aims': { code: 0, data: { appCode: 'aims', uid: 'u1', roles: [], resources: { timesheet: ['submit'], products: ['view'] } } },
      '/enterprise/api/auth/permissions?app=assets': { code: 0, data: { appCode: 'assets', uid: 'u1', roles: [], resources: { products: ['edit'] } } },
      // SPA fallback for an unregistered path: 200 text/html parsed as a string.
      '/enterprise/api/auth/permissions?app=codocs': '<!DOCTYPE html><html></html>'
    }
    const globals = globalThis as Record<string, unknown>
    const previous = Object.fromEntries(['useRuntimeConfig', 'useRouter', 'useRoute', 'computed', 'watch', '$fetch'].map(key => [key, globals[key]]))
    const previousError = console.error
    Object.assign(globals, {
      useRuntimeConfig: () => ({ public: { appCode: 'enterprise' } }),
      useRouter: () => ({ currentRoute }),
      useRoute: () => { throw new Error('useRoute must not be used outside a component') },
      computed,
      watch,
      $fetch: async (url: string) => {
        requests.push(url)
        return responses[url]
      }
    })
    console.error = () => {}
    try {
      const { useAuthorization } = await import('../app/composables/useAuthorization')
      const authorization = useAuthorization()

      await authorization.loadAuthorization()
      assert.equal(authorization.authorizationApp.value, 'aims')
      assert.deepEqual(authorization.getAuthorization()?.resources, { timesheet: ['submit'], products: ['view'] })
      assert.equal(authorization.loaded.value, true)
      assert.equal(authorization.error.value, null)

      currentRoute.value = { meta: { authorizationApp: 'assets' } }
      // The Aims snapshot is not visible on an Assets page before its own load.
      assert.equal(authorization.getAuthorization(), null)
      assert.equal(authorization.loaded.value, false)
      await authorization.loadAuthorization()
      assert.deepEqual(authorization.getAuthorization()?.resources, { products: ['edit'] })

      currentRoute.value = { meta: { authorizationApp: 'aims' } }
      assert.deepEqual(authorization.getAuthorization()?.resources, { timesheet: ['submit'], products: ['view'] })

      currentRoute.value = { meta: {} }
      const beforeUnowned = requests.length
      assert.deepEqual(await authorization.loadAuthorization(), authorization.getAuthorization())
      assert.deepEqual(authorization.getAuthorization()?.resources, {})
      assert.equal(requests.length, beforeUnowned, 'a page without an owning module requests nothing')

      currentRoute.value = { meta: { authorizationApp: 'codocs' } }
      await authorization.loadAuthorization()
      assert.equal(authorization.loaded.value, true)
      assert.equal(authorization.getAuthorization(), null)
      assert.ok(authorization.error.value instanceof AuthorizationSnapshotResponseError, 'HTML is an error, not an empty snapshot')

      assert.deepEqual(requests, [
        '/enterprise/api/auth/permissions?app=aims',
        '/enterprise/api/auth/permissions?app=assets',
        '/enterprise/api/auth/permissions?app=codocs'
      ])
    } finally {
      console.error = previousError
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) Reflect.deleteProperty(globals, key)
        else globals[key] = value
      }
    }
  })
})
