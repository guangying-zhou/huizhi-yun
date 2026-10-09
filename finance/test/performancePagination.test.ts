import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Finance large lists use real pagination instead of oversized first-page reads', () => {
  const page = read('app/pages/[...slug].vue')
  const snapshots = read('app/components/bank-accounts/BankAccountBalanceSlideover.vue')
  const invoiceDialogs = read('app/components/invoices/InvoiceLifecycleDialogs.vue')
  const projectAccounting = read('server/api/v1/finance/project-accounting/aims-projects.get.ts')

  assert.doesNotMatch(page, /pageSize:\s*(500|1000)/)
  assert.match(page, /v-if="!isBalanceChangesPage"/)
  assert.match(snapshots, /v-model:page="page"/)
  assert.match(snapshots, /pageSize:\s*20/)
  assert.doesNotMatch(invoiceDialogs, /pageSize:\s*1000/)
  assert.match(invoiceDialogs, /accounts\.length >= result\.total/)
  assert.match(projectAccounting, /project_codes: projectCodes\.length \? projectCodes\.join\(','\)/)
  assert.match(projectAccounting, /total: Number\(aimsProjects\?\.total \|\| 0\)/)
  assert.doesNotMatch(projectAccounting, /fetchAllFinanceRows/)
})

test('both staging entrypoints cache hashed Nuxt assets for every app exposed by dev-stack', () => {
  const expected = /location ~ \^\/\(\?:_nuxt\/\|\(aims\|altoc\|assets\|codocs\|finance\|workflow\)\/_nuxt\/\)/
  assert.match(read('../deploy/dev-stack/nginx.staging.conf'), expected)
  assert.match(read('../deploy/dev-stack/nginx.staging.ssl.conf'), expected)
})
