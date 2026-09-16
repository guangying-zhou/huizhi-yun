import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DATA_RUNTIME_PRODUCT,
  normalizeDataRuntimeHealth
} from '../server/utils/dataRuntimeHealth.ts'

test('data runtime health accepts the explicit product identity', () => {
  const health = normalizeDataRuntimeHealth({
    runtimeProduct: DATA_RUNTIME_PRODUCT,
    status: 'ok',
    version: '1.2.3',
    tenant: 'C000001',
    deployment: 'C000001-console',
    apps: {
      console: { enabled: true, db: 'ok' }
    }
  }, '/runtime/health')

  assert.equal(health.reachable, true)
  assert.equal(health.runtimeProduct, DATA_RUNTIME_PRODUCT)
  assert.equal(health.status, 'ok')
  assert.deepEqual(health.apps.console, { enabled: true, db: 'ok' })
})

test('data runtime health keeps a bounded legacy compatibility signature', () => {
  const health = normalizeDataRuntimeHealth({
    status: 'ok',
    apps: {
      finance: { enabled: true, db: 'ok' }
    }
  }, '/runtime/healthz')

  assert.equal(health.runtimeProduct, 'hzy-data-runtime-legacy')
})

test('data runtime health rejects Connector Runtime and envelope responses', () => {
  assert.throws(
    () => normalizeDataRuntimeHealth({
      code: 0,
      data: {
        runtimeProduct: 'hzy-connector-runtime',
        status: 'ok'
      }
    }, '/runtime/health'),
    /not hzy-data-runtime/
  )

  assert.throws(
    () => normalizeDataRuntimeHealth({
      runtimeProduct: 'hzy-connector-runtime',
      status: 'ok',
      apps: {}
    }, '/runtime/health'),
    /not hzy-data-runtime/
  )
})
