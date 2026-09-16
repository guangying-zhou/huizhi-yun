import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('invoice request and receipt task URLs use exact-code detail pages', () => {
  const invoicePage = read('../app/pages/invoices/requests/[code].vue')
  const receiptPage = read('../app/pages/receipts/[code].vue')

  assert.match(invoicePage, /financeApiPath\(`\/invoice-requests\/\$\{encodeURIComponent\(code\.value\)\}`\)/)
  assert.match(receiptPage, /financeApiPath\(`\/receipts\/\$\{encodeURIComponent\(code\.value\)\}`\)/)
  for (const page of [invoicePage, receiptPage]) {
    assert.match(page, /v-if="loading"/)
    assert.match(page, /v-else-if="loadError"/)
    assert.match(page, /v-else-if="!request"|v-else-if="!receipt"/)
  }
})

test('detail action buttons use independent actions and exact write endpoints', () => {
  const invoicePage = read('../app/pages/invoices/requests/[code].vue')
  const receiptPage = read('../app/pages/receipts/[code].vue')

  assert.match(invoicePage, /hasPermission\('invoices', 'issue'\)/)
  assert.match(invoicePage, /v-if="canIssueCurrent"/)
  assert.match(invoicePage, /`\/invoice-requests\/\$\{encodeURIComponent\(code\.value\)\}\/issue`/)
  assert.doesNotMatch(invoicePage, /hasPermission\('invoices', '(?:edit|approve|admin)'\)/)

  assert.match(receiptPage, /hasPermission\('reconciliation', 'confirm'\)/)
  assert.match(receiptPage, /v-if="canReconcileCurrent"/)
  assert.match(receiptPage, /financeApiPath\('\/reconciliation'\)/)
  assert.doesNotMatch(receiptPage, /hasPermission\('receipts', '(?:edit|confirm|admin)'\)/)
})

test('BFF injects trusted responsibility access and strips browser forgeries', () => {
  const dataRuntime = read('../server/utils/dataRuntime.ts')
  const scopedAuthorization = read('../server/utils/financeScopedAuthorization.ts')
  const runtimeAuth = read('../../data-runtime/internal/apps/finance/runtime_auth.go')

  for (const key of ['current_user_invoice_request_access', 'current_user_receipt_access']) {
    assert.match(dataRuntime, new RegExp(`'${key}'`))
    assert.match(runtimeAuth, new RegExp(`"${key}"`))
  }
  assert.match(dataRuntime, /resolveFinanceResponsibilityAccessQuery/)
  assert.match(dataRuntime, /sanitizeRuntimeRecord/)
  assert.match(scopedAuthorization, /type FinanceResponsibilityAccess = 'all' \| 'relation' \| 'none'/)
  // 走查 ISSUE-B-011：空范围不再无条件放行全量，必须有显式 tenant:global。
  // manifest 已声明 supportedScopes = ['tenant:global','subject:self']，
  // 因此全局访问本就是可显式表达的范围。
  assert.match(scopedAuthorization, /scopeGroups\.length === 0\) return hasExplicitTenantGlobalScope\(grant\) \? 'all' : 'none'/)
  assert.match(scopedAuthorization, /isSubjectSelfScope/)
  assert.match(scopedAuthorization, /return relation \? 'relation' : 'none'/)
})

test('project accounting code filters require the explicit project code predicate', () => {
  const scopedAuthorization = read('../server/utils/financeScopedAuthorization.ts')
  assert.match(scopedAuthorization, /return predicate === 'code' \? value : ''/)
  assert.doesNotMatch(scopedAuthorization, /predicate === 'member' \|\| predicate === 'owner' \? value/)
})

test('runtime read and issue/confirm/reconciliation writes enforce current responsibility', () => {
  const queryHelpers = read('../../data-runtime/internal/apps/finance/query_helpers.go')
  const issueWrite = read('../../data-runtime/internal/apps/finance/write_invoice_requests.go')
  const reconciliationWrite = read('../../data-runtime/internal/apps/finance/write_custom.go')
  const genericWrite = read('../../data-runtime/internal/apps/finance/write_specs.go')

  assert.match(queryHelpers, /applyFinanceResponsibilityListAccess/)
  assert.match(queryHelpers, /financeResponsibilityDetailWhere/)
  assert.match(issueWrite, /requireFinanceResponsibilityBodyAccess\(body, request, financeInvoiceRequestResponsibilityTarget\)/)
  assert.match(reconciliationWrite, /requireFinanceResponsibilityBodyAccess\(body, receipt, financeReceiptResponsibilityTarget\)/)
  assert.match(genericWrite, /spec\.Table == "finance_receipt"[\s\S]{0,220}requireFinanceResponsibilityBodyAccess/)
})

test('manifest advertises only the existing global and self scope model', () => {
  const manifest = JSON.parse(read('../app.manifest.json')) as { supportedScopes?: string[] }
  assert.deepEqual(manifest.supportedScopes, ['tenant:global', 'subject:self'])
})
