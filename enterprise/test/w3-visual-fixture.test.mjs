import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { visualResponse } from './fixtures/w3-visual-data.mjs'

test('W3 visual fixture uses explicit synthetic identities and whitelisted source/amount metadata', () => {
  const response = path => visualResponse(new URL(path, 'http://127.0.0.1:3417'), 'GET', undefined, {}, [])
  assert.equal(response('/enterprise/api/auth/me').tenant, 'FIXTURE')
  const customer = response('/altoc/api/v1/customers/1').data
  assert.equal(customer.customer_level_name, '战略客户')
  assert.equal(customer.hasHiddenChildren, true)
  assert.equal(Object.hasOwn(customer, 'hiddenChildCount'), false)
  assert.deepEqual(Object.keys(customer.source_info), ['system', 'table', 'pk', 'batchCode', 'importedAt'])
  const summary = response('/altoc/api/v1/contracts?customerIds=2,3').data.customerSummaries['2']
  assert.equal(summary.count, 1)
  assert.equal(summary.amounts[0].currency_code, 'CNY')
  assert.equal(response('/finance/api/v1/bank-accounts?complete=true').complete, true)
  assert.throws(() => response('/unknown/api/live-endpoint'), /Unregistered synthetic API/)
})
test('W3 visual runner blocks external networking and exercises both viewport sizes through real Host routes', () => {
  const source = readFileSync(new URL('../scripts/w3-visual-check.mjs', import.meta.url), 'utf8')
  assert.match(source, /origin = 'http:\/\/127\.0\.0\.1:3417'/)
  assert.match(source, /url.origin !== origin/)
  assert.match(source, /return route.abort\(\)/)
  assert.match(source, /'1440,390'/)
  assert.match(source, /page.on\('pageerror'/)
  assert.match(source, /page.screenshot/)
  assert.doesNotMatch(source, /hzy0\.isme|process.env.*TOKEN|password|\.env\.dev/)
})
