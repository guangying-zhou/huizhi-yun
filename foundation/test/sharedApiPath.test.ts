import assert from 'node:assert/strict'
import test from 'node:test'
import { ENTERPRISE_SHARED_API_BASE, resolveSharedApiBase, resolveSharedApiPath } from '../shared/utils/sharedApiPath'
import { sharedApiPath } from '../app/utils/sharedApiPath'

test('standalone applications keep the root Foundation API contract', () => {
  for (const config of [undefined, null, {}, { appCode: 'console' }, { appCode: 'aims', sharedApiBase: ENTERPRISE_SHARED_API_BASE }]) {
    assert.equal(resolveSharedApiPath('/api/notifications/summary', config), '/api/notifications/summary')
  }
})

test('only the Enterprise Host with its exact configured base is remapped', () => {
  const host = { appCode: 'enterprise', sharedApiBase: '/enterprise/api/foundation' }
  assert.equal(resolveSharedApiPath('/api/workflow-proxy/tasks/12/approve', host), '/enterprise/api/foundation/workflow-proxy/tasks/12/approve')
  assert.equal(resolveSharedApiPath('/api', host), '/enterprise/api/foundation')
  // Any other value, including look-alikes and absolute URLs, keeps the root contract.
  for (const sharedApiBase of ['/api', '', '/enterprise/api', '/enterprise/api/foundation/', 'https://evil.example/api', '//evil.example', '/enterprise/api/foundation/../../x']) {
    assert.equal(resolveSharedApiBase({ appCode: 'enterprise', sharedApiBase }), '/api', sharedApiBase)
  }
})

test('only root /api paths are accepted', () => {
  for (const path of ['/aims/api/v1/x', 'api/notifications', '/apix', 'https://example.com/api/x', '']) {
    assert.throws(() => resolveSharedApiPath(path), /must start with \/api\//, path)
  }
})

test('without a Nuxt context the browser helper keeps the root contract', () => {
  assert.equal(sharedApiPath('/api/directory/me'), '/api/directory/me')
})
