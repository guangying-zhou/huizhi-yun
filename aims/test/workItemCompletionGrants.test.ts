import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const manifest = JSON.parse(read('aims/app.manifest.json'))
const workflow = JSON.parse(read('workflow/app.manifest.json'))
const has = (m: typeof manifest, capability: string) => { const [app, resource, action] = capability.split(':'); return m.appCode === app && m.resources.some((row: { code: string, actions: string[] }) => row.code === resource && row.actions.includes(action)) }
test('completion grant candidates match declared exact resources and both Runtime audiences without reactivating revoked grants', () => {
  for (const version of ['v2.6-aims', 'v2.7-workflow']) {
    const suffix = 'work-item-completion'
    const seed = read(`console/docs/sql/Console-SQL-Seed-${version}-${suffix}-grants.sql`)
    const verify = read(`console/docs/sql/Console-SQL-Verify-${version}-${suffix}-grants.sql`)
    assert.match(seed, /NOT EXISTS/u)
    assert.doesNotMatch(seed, /ON DUPLICATE KEY UPDATE/u)
    for (const audience of ['data-runtime', 'tenant-runtime']) { assert.ok(seed.includes(audience)); assert.ok(verify.includes(audience)) }
    assert.ok(verify.includes('NOT_ACTIVE'))
    assert.ok(verify.includes('BINDING_MISMATCH'))
  }
  assert.ok(has(manifest, 'aims:work-item-complete:execute'))
  assert.ok(has(manifest, 'aims:work-item-completion-callback:execute'))
  assert.ok(has(manifest, 'aims:work-item-completion-replay:execute'))
  assert.ok(has(workflow, 'workflow:work-item-complete:create'))
  const template = JSON.parse(read('deploy/test-env/aims-work-item-completion-readiness.template.json'))
  assert.deepEqual(template.runtimePolicy.audiences, ['data-runtime', 'tenant-runtime'])
  assert.deepEqual(template.workflowTargetPolicy.runtimeAudiences, ['data-runtime', 'tenant-runtime'])
  assert.equal(template.status, 'candidate-not-applied')
})
