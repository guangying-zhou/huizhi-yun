import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { invoiceMediumOptions, pageConfigs } from '../app/config/pageConfigs.ts'

describe('Finance catch-all page configuration', () => {
  test('keeps the complete routed page catalog after extraction', () => {
    assert.equal(Object.keys(pageConfigs).length, 28)
    for (const route of [
      'invoices',
      'invoices/requests',
      'receipts',
      'reconciliation',
      'bank-accounts',
      'bank-accounts/balance-changes',
      'project-accounting',
      'settings/audit-logs',
      'reports'
    ]) {
      assert.ok(pageConfigs[route], `missing Finance page config: ${route}`)
    }
  })

  test('keeps every runtime page self-describing and endpoint-safe', () => {
    for (const [route, config] of Object.entries(pageConfigs)) {
      assert.ok(config.title.trim(), `${route} must have a title`)
      assert.ok(config.description.trim(), `${route} must have a description`)
      assert.ok(Array.isArray(config.columns), `${route} must define columns`)
      if (config.endpoint) assert.match(config.endpoint, /^\//, `${route} endpoint must be relative to Finance API`)
    }
  })

  test('shares the same invoice medium choices across create and issue flows', () => {
    assert.deepEqual(invoiceMediumOptions.map(option => option.value), ['electronic', 'paper'])
    const invoiceMediumField = pageConfigs.invoices?.createFields?.find(field => field.key === 'invoiceMedium')
    assert.equal(invoiceMediumField?.options, invoiceMediumOptions)
  })
})
