import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)

  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('Altoc invoice file preview scoped authorization', () => {
  test('server preview validates scoped contract invoices before signing file URL', () => {
    const content = source('server/api/v1/contracts/invoice-files/view.get.ts')

    assert.match(content, /maybeCallTenantRuntime/)
    assert.match(content, /requirePermission\(event, 'contract', 'view'\)/)
    assert.match(content, /resolveCurrentAltocDataAccessQuery\(event, 'contract', 'view'\)/)
    assert.match(content, /\/v1\/altoc\/contracts\/\$\{encodeURIComponent\(input\.contractRef\)\}\/invoices/)
    assert.match(content, /invoiceMatches\(invoice, input\)/)
    assert.match(content, /发票文件未关联或无权预览/)
    assertBefore(content, 'await verifyInvoiceFileAccess(event', 'await createFinanceInvoiceFileViewUrl')
  })

  test('server preview requires contract context and matches invoice file URL', () => {
    const content = source('server/api/v1/contracts/invoice-files/view.get.ts')

    assert.match(content, /const contractRef = stringValue\(query\.contract_id \|\| query\.contractId \|\| query\.contract_code \|\| query\.contractCode\)/)
    assert.match(content, /const invoiceCodeValue = stringValue\(query\.invoice_code \|\| query\.invoiceCode \|\| query\.code\)/)
    assert.match(content, /if \(!input\.contractRef\)/)
    assert.match(content, /return invoiceFileUrl\(invoice\) === input\.url/)
  })

  test('contract detail page passes contract and invoice context into file preview request', () => {
    const content = source('app/pages/contracts/[id].vue')

    assert.match(content, /params\.set\('contract_id', String\(id\.value\)\)/)
    assert.match(content, /const invoiceCode = String\(row\.code \|\| row\.invoice_code \|\| row\.invoiceCode \|\| ''\)\.trim\(\)/)
    assert.match(content, /if \(invoiceCode\) params\.set\('invoice_code', invoiceCode\)/)
  })
})
