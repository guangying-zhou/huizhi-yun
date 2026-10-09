import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { businessModules, registerBusinessPages } from '../composition/registry.mjs'

test('Finance Host module registers its account, parameter and APF11a frontend routes', () => {
  const registeredPages = registerBusinessPages([], businessModules, 'placeholder.vue')
  const finance = businessModules.find(module => module.code === 'finance')
  assert.ok(finance)
  assert.equal(finance.pages.length, 73)
  const paths = ['/finance/historical-finance', '/finance/historical-finance/:code', '/finance/receipts/:code/allocate', '/finance/receivable-adjustments', '/finance/receivable-adjustments/new', '/finance/receivable-adjustments/:code', '/finance/allocation-batches', '/finance/allocation-batches/:code', '/finance/migration', '/finance/legal-entities', '/finance/bank-accounts', '/finance/bank-accounts/balances', '/finance/bank-accounts/:code', '/finance/settings/people-cost-parameters', '/finance/settings/people-cost-parameters/new', '/finance/settings/people-cost-parameters/:code/edit']
  for (const path of paths) {
    const page = registeredPages.find(page => page.path === path)
    assert.ok(page, path)
    assert.equal(page.meta.authorizationApp, 'finance', path)
  }
  assert.equal(finance.navigation.length, 26)
  assert.deepEqual(finance.navigation.find(item => item.to.endsWith('/people-cost-parameters')).permission, { resource: 'settings', action: 'admin' })
  assert.deepEqual(finance.navigation.find(item => item.to === '/finance/legal-entities').permission, { resource: 'legal_entities', action: 'view' })
  assert.ok(finance.navigation.every(item => item.permission))
})

test('Host includes Finance Tailwind sources and generated navigation', () => {
  const css = readFileSync(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')
  assert.match(css, /finance\/app/)
  assert.match(css, /finance\/layer/)
  const navigation = readFileSync(new URL('../app/utils/enterprise-navigation.ts', import.meta.url), 'utf8')
  assert.match(navigation, /finance\/bank-accounts/)
  assert.match(navigation, /finance\/settings\/people-cost-parameters/)
})
