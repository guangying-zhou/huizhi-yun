import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  COLLAB_CAPABILITIES,
  COLLAB_CLIENT,
  collabGrantItems,
  g7ExpectedGrants,
  validateCollabBindings,
  validateG7Bindings
} from '../scripts/g7-prod-grant-catalog.mjs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const collabSource = read('../../collab/src/utils/v2-snapshots.ts')
const runtimeRoutes = read('../../data-runtime/internal/server/codocs_collaboration_snapshots.go')
const seed = read('../docs/sql/Console-SQL-Seed-v2.33-prod-service-grants.sql')
const rollback = read('../docs/sql/Console-SQL-Rollback-v2.33-prod-service-grants.sql')
const bindings = {
  tenant: 'C000001',
  deployments: {
    enterprise: 'C000001-prod-enterprise', workflow: 'C000001-workflow', aims: 'C000001-aims',
    codocs: 'C000001-codocs', console: 'C000001-console', collab: 'C000001-collab'
  }
}

test('collab.runtime grants are exactly the capabilities Collab requests and the Runtime enforces', () => {
  const requested = [...collabSource.matchAll(/(?:READ|PUBLISH)_CAPABILITY = '([^']+)'/g)].map(match => match[1])
  assert.deepEqual([...COLLAB_CAPABILITIES].sort(), requested.sort())
  const enforced = [...runtimeRoutes.matchAll(/collaborationSnapshot(?:Read|Publish)Capability\s*=\s*"([^"]+)"/g)].map(match => match[1])
  assert.deepEqual([...COLLAB_CAPABILITIES].sort(), enforced.sort())
  assert.match(collabSource, /tokens\.getToken\('data-runtime', capability/)
  assert.match(runtimeRoutes, /SourceAppCode: "collab"[\s\S]*ClientID != "collab\.runtime"/)
})

test('collab grants carry audience, tenant and deployment bindings and nothing broader', () => {
  const items = collabGrantItems(bindings)
  assert.equal(items.length, 2)
  for (const item of items) {
    assert.equal(item.client, COLLAB_CLIENT)
    assert.equal(item.app, 'collab')
    assert.equal(item.audience, 'data-runtime')
    assert.equal(item.deployment, 'C000001-collab')
    assert.equal(item.resource, 'data-runtime:codocs:collaboration-snapshots')
    assert.ok(['read', 'publish'].includes(item.action))
  }
  // Collab holds no Host-delegation, Aims/Codocs OSS or tenant-runtime capability.
  const all = g7ExpectedGrants(bindings)
  assert.equal(all.length, 30)
  assert.deepEqual(all.filter(item => item.client === COLLAB_CLIENT).map(item => item.scope), [...COLLAB_CAPABILITIES])
  assert.ok(!all.some(item => item.client === COLLAB_CLIENT && item.audience !== 'data-runtime'))
})

test('collab binding stays optional and follows the reviewed deployment code convention', () => {
  const { collab: _collab, ...withoutCollab } = bindings.deployments
  assert.equal(g7ExpectedGrants({ tenant: bindings.tenant, deployments: withoutCollab }).length, 28)
  assert.throws(() => validateG7Bindings({ ...bindings, deployments: { ...bindings.deployments, collab: 'C000001-test-collab' } }), /reviewed production deployment code/)
  assert.throws(() => validateG7Bindings({ ...bindings, deployments: { ...bindings.deployments, extra: 'C000001-extra' } }), /unknown deployment binding/)
  assert.throws(() => validateCollabBindings({ tenant: 'C000001', deployments: { collab: 'C000002-collab' } }), /reviewed production deployment code/)
})

test('collab seed creates a secret-free client without a credential pointer and rollback refuses one', () => {
  const section = (seed.split(/^-- name: /m).find(part => part.startsWith('collab-service-client')) || '')
    .split('\n').filter(line => !line.startsWith('--')).join('\n')
  assert.match(section, /'collab\.runtime'[\s\S]*'collab'/)
  assert.doesNotMatch(section, /secret|credential|hash|password/i)
  assert.doesNotMatch(section, /current_credential_id/)
  assert.match(rollback, /client_code='collab\.runtime' AND current_credential_id IS NULL/)
})
