import test from 'node:test'
import assert from 'node:assert/strict'
import { productCenterLink } from '../app/utils/productCenterLink.ts'

test('product center deep link uses authorized directory base and Console Shell', () => {
  const apps = [{ appCode: 'aims', homeUrl: 'https://tenant.test/aims/', basePath: '/aims/' }, { appCode: 'console', homeUrl: 'https://tenant.test/' }]
  assert.equal(productCenterLink(apps, 'P1', 'https://tenant.test'), '/shell/aims?target=%2Faims%2Fproducts%2FP1')
  assert.equal(productCenterLink(apps, 'P1', 'https://assets.test'), 'https://tenant.test/aims/products/P1')
  assert.equal(productCenterLink([], 'P1', 'https://tenant.test'), '')
  assert.equal(productCenterLink(apps, '../P1', 'https://tenant.test'), '')
  assert.equal(productCenterLink([{ ...apps[0]!, basePath: '//evil.test' }], 'P1', 'https://tenant.test'), '')
  assert.equal(productCenterLink([{ ...apps[0]!, basePath: undefined }], 'P1', 'https://tenant.test'), '')
  assert.equal(productCenterLink([{ ...apps[0]!, homeUrl: 'javascript:alert(1)' }], 'P1', 'https://tenant.test'), '')
})
