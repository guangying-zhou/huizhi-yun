import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { localApplications } from '../application-set.cjs'
import { expectedListeners } from '../probe-listeners.mjs'

const profile = retired => ({ identity: { consoleFacadeMode: 'local-canonical-facade' },
  features: { workflowLocal: true, codocsCollaborationV2: true, aimsRetired: retired }, listeners: {} })
test('retirement removes only physical Aims from applications and listeners', () => {
  assert.deepEqual(localApplications(profile(false)), ['gateway', 'enterprise', 'codocs-editor', 'console', 'collab', 'workflow', 'aims'])
  assert.deepEqual(localApplications(profile(true)), localApplications(profile(false)).filter(app => app !== 'aims'))
  assert.ok(expectedListeners(profile(false)).some(item => item.name === 'aims'))
  assert.equal(expectedListeners(profile(true)).some(item => item.name === 'aims'), false)
  assert.ok(expectedListeners(profile(true)).some(item => item.name === 'workflow'))
})
test('up and restart use the same physical inventory and reject explicit retired restart', () => {
  const cli = readFileSync(new URL('../../local-enterprise.mjs', import.meta.url), 'utf8')
  assert.equal(cli.match(/localApplications\(loaded.value\)/g)?.length, 2)
  assert.ok(cli.includes("values.app === 'aims' && loaded.value.features?.aimsRetired === true"))
  const runner = readFileSync(new URL('../run-process.mjs', import.meta.url), 'utf8')
  assert.ok(runner.includes("if (profile.features?.aimsRetired === true) throw Error('Aims physical process is retired')"))
  const pm2 = readFileSync(new URL('../pm2.config.cjs', import.meta.url), 'utf8')
  assert.ok(pm2.includes('apps: localApplications(configuration)'))
})

test('retired doctor also verifies the old port and rejects a live physical Aims', () => {
  const source = readFileSync(new URL('../../local-enterprise.mjs', import.meta.url), 'utf8')
  assert.match(source, /Retired physical Aims is still online/)
  assert.match(source, /portClosed: await portAvailable\('127\.0\.0\.1', 23141\)/)
  assert.match(source, /retiredAims\.portClosed && retiredAims\.processStopped/)
})
