import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('approval selector lists all eight registered pilot business tuples', () => {
  const page = readFileSync(new URL('../app/pages/enterprise/approvals/index.vue', import.meta.url), 'utf8')
  const values = [...page.matchAll(/value: '([^']+)'/g)].map(match => match[1])
  assert.deepEqual(values, ['aims/tasks/complete', 'altoc/quotation/approve', 'altoc/contract/approve', 'finance/invoices/request', 'finance/expenses/claim', 'finance/expenses/project_expense', 'finance/expenses/payment', 'people/assignments/change'])
})
