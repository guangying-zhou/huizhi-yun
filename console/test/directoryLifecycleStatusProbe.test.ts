import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeLifecycleProbe } from '../server/utils/directoryLifecycleStatusProbe'
import { directoryCommandSource } from '../server/utils/directoryLifecycleReliable'

test('exact lifecycle probe is read only, closed and bound to verified Enterprise source', () => {
  const query = { uid: 'employee', kind: 'offboarding', revision: '7', hash: 'a'.repeat(64) }
  assert.deepEqual(normalizeLifecycleProbe(query), { ...query, revision: 7 })
  for (const change of [{ kind: ['offboarding'] }, { revision: ['7'] }, { kind: 'ldap' }, { revision: 0 }, { revision: 'NaN' }, { uid: '../employee' }, { hash: 'private-url' }, { sourceApp: 'enterprise' }, { approved: true }]) assert.throws(() => normalizeLifecycleProbe({ ...query, ...change }), { statusCode: 400 })
  const actor = { actorType: 'service', actorId: 'enterprise.runtime', appCode: 'enterprise', tenantCode: 'C000001', deploymentCode: 'Host' }
  assert.equal(directoryCommandSource(actor), 'enterprise')
  for (const change of [{ actorType: 'user' }, { actorId: 'other.runtime' }, { tenantCode: '' }, { deploymentCode: '' }, { appCode: 'people' }]) assert.throws(() => directoryCommandSource({ ...actor, ...change }), { statusCode: 403 })
  const source = readFileSync(new URL('../server/api/v1/console/service/directory/onboarding/lifecycle-command-status.get.ts', import.meta.url), 'utf8')
  for (const field of ['console:directory-offboarding:disable', 'console:directory-employment:sync', 'requireBoundTargetApp: true', 'directoryCommandSource(actor) !== \'enterprise\'', 'statusCode: 503', 'directory_status_unavailable']) assert.ok(source.includes(field), field)
  assert.doesNotMatch(source, /UPDATE|INSERT|applyConsoleDirectoryLifecycle|readBody/)
})
