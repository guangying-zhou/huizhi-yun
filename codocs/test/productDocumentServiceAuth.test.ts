import test from 'node:test'
import assert from 'node:assert/strict'
import manifest from '../app.manifest.json' with { type: 'json' }
import { AIMS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH as requirement, requireCodocsServiceAuth } from '../server/lib/serviceAuthPolicy'
const valid = { authenticated: true, tokenUse: 'service', subjectType: 'service', appCode: 'aims', clientCode: 'aims.runtime', scopes: ['codocs:product-document:read'] }
test('product document service capability is declared and exact', () => {
  assert.ok(manifest.resources.some(resource => `codocs:${resource.code}:read` === requirement.scope && resource.actions.includes('read')))
  assert.doesNotThrow(() => requireCodocsServiceAuth(valid, requirement))
  for (const scopes of [[], ['codocs:*'], ['codocs:admin'], ['codocs:project-document:content:read']]) assert.throws(() => requireCodocsServiceAuth({ ...valid, scopes }, requirement), { statusCode: 403 })
})
test('product document delegated actor endpoint rejects wrong identity and retains outages', () => {
  for (const input of [{ ...valid, appCode: 'assets' }, { ...valid, clientCode: 'aims' }]) assert.throws(() => requireCodocsServiceAuth(input, requirement), { statusCode: 403 })
  assert.throws(() => requireCodocsServiceAuth({ ...valid, tokenUse: 'user' }, requirement), { statusCode: 401 })
  assert.throws(() => requireCodocsServiceAuth({ ...valid, authenticated: false, reason: 'service_token_introspection_unavailable' }, requirement), { statusCode: 503 })
})
