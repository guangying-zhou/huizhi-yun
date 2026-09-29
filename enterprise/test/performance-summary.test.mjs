import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizePerformance } from '../scripts/summarize-performance.mjs'
const sample = value => ({ variant: 'enterprise', scenario: 'product-list', cache: 'warm', metric: 'ready', unit: 'ms', environment: 'test', role: 'product-manager', datasetRevision: 'fixture-v1', artifact: 'sha256:abc', value })
test('calculates documented quantiles without altering input measurements', () => {
  const samples = Array.from({ length: 20 }, (_, i) => sample(20 - i))
  const output = summarizePerformance(samples)
  assert.equal(output.groups[0].p50, 10)
  assert.equal(output.groups[0].p95, 19)
  assert.equal(samples[0].value, 20)
  assert.equal(output.deploymentReady, false)
})
test('never combines different data, roles, caches or artifacts to manufacture sufficient samples', () => {
  const samples = Array.from({ length: 19 }, (_, i) => sample(i))
  for (const dimension of ['role', 'artifact', 'datasetRevision', 'cache', 'variant']) {
    const changed = { ...sample(100), [dimension]: dimension === 'cache' ? 'cold' : dimension === 'variant' ? 'legacy' : 'other' }
    const output = summarizePerformance([...samples, changed])
    assert.equal(output.groups.length, 2)
    assert.ok(output.groups.every(group => !group.sufficient && group.p95 === null && group.p50 === null))
  }
})
test('rejects nonmeasurements and extra potentially sensitive input fields', () => {
  for (const bad of [{ ...sample(1), value: -1 }, { ...sample(1), value: Infinity }, { ...sample(1), headers: { authorization: 'secret' } }]) assert.throws(() => summarizePerformance([bad]))
  assert.throws(() => summarizePerformance([]))
})
