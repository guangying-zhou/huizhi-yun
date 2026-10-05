import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { createError } from 'h3'

// Root rule: a Console authorization outage stays 503 and is never reported as
// the user lacking a permission (403).
test('checkPermission/checkRole: outage is 503, authentication refusal is false, grants are honoured', async () => {
  const globals = globalThis as Record<string, unknown>
  globals.createError = createError
  globals.__snapshot = async () => ({ roles: ['aims.member'], resources: { projects: ['view'] } })
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      const stub: Record<string, string> = {
        '~~/app/config/permissions': 'export const appCode=\'aims\'',
        '@hzy/foundation/server/utils/platformBundleAuthorization': 'export const loadAuthorizationSnapshotFromConsoleRuntime=(...args)=>globalThis.__snapshot(...args)'
      }
      if (stub[specifier]) return { url: `data:text/javascript,${encodeURIComponent(stub[specifier])}`, shortCircuit: true }
      if (specifier === '@hzy/foundation/shared/utils/authorizationActions') return next(new URL('../../foundation/shared/utils/authorizationActions.ts', import.meta.url).href, context)
      return next(specifier, context)
    }
  })
  globals.getRequestUid = () => 'person-a'
  try {
    const { checkPermission, checkRole, requirePermission } = await import('../server/utils/checkPermission.ts')
    const event = {} as never
    assert.equal(await checkPermission(event, 'projects', 'view'), true)
    assert.equal(await checkPermission(event, 'projects', 'admin'), false)
    assert.equal(await checkRole(event, 'aims.member'), true)
    await assert.rejects(requirePermission(event, 'projects', 'admin'), (error: { statusCode?: number }) => error.statusCode === 403)
    for (const status of [401, 403]) {
      globals.__snapshot = async () => {
        throw createError({ statusCode: status, message: 'denied' })
      }
      assert.equal(await checkPermission(event, 'projects', 'view'), false)
      assert.equal(await checkRole(event, 'aims.member'), false)
    }
    for (const failure of [createError({ statusCode: 503, message: 'console down' }), new Error('fetch failed'), createError({ statusCode: 500, message: 'boom' })]) {
      globals.__snapshot = async () => {
        throw failure
      }
      await assert.rejects(checkPermission(event, 'projects', 'view'), (error: { statusCode?: number }) => error.statusCode === 503)
      await assert.rejects(checkRole(event, 'aims.member'), (error: { statusCode?: number }) => error.statusCode === 503)
      await assert.rejects(requirePermission(event, 'projects', 'view'), (error: { statusCode?: number }) => error.statusCode === 503, 'requirePermission must not turn an outage into 403')
    }
  } finally {
    hooks.deregister()
    delete globals.__snapshot
  }
})
