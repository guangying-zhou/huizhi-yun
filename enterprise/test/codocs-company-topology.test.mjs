import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveEnterprisePilotPath } from '../../deploy/test-env/enterprise-topology.mjs'

const b2Operations = [
  ['GET', '/codocs/api/company-assets/list'],
  ['GET', '/codocs/api/company-assets/preview'],
  ['POST', '/codocs/api/company-assets/mkdir'],
  ['DELETE', '/codocs/api/company-assets/directory'],
  ['POST', '/codocs/api/company-assets/move'],
  ['POST', '/codocs/api/company-assets/archive'],
  ['GET', '/codocs/api/company-assets/access-records'],
  ['GET', '/codocs/api/company-assets/access-records/export'],
  ['GET', '/codocs/api/company-assets/import-source'],
  ['POST', '/codocs/api/company-assets/import-documents'],
  ['GET', '/codocs/api/open-department-docs'],
  ['GET', '/codocs/api/open-department-docs/550e8400-e29b-41d4-a716-446655440000'],
  ['POST', '/codocs/api/published-asset-links'],
  ['GET', '/codocs/api/published-asset-links/AAAAAAAAAAAAAAAA']
]

test('the existing Codocs Host gateway prefix forwards every B2 method and path', () => {
  for (const [method, path] of b2Operations) {
    assert.deepEqual(resolveEnterprisePilotPath(path, '', method), { path, kind: 'api' }, `${method} ${path}`)
  }
})
