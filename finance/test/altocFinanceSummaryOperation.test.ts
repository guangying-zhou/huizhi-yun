import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8')

test('reconciliation delegates only the runtime-created operation and never rebuilds target identity from browser body', () => {
  const endpoint = read('server/api/v1/finance/reconciliation/index.post.ts')
  assert.match(endpoint, /data\.altocFinanceSummaryOperation/)
  assert.match(endpoint, /tryDispatchAltocFinanceSummaryOperation\(event, operationKey\)/)
  assert.doesNotMatch(endpoint, /syncAltocFinanceSummary|requestBody\.contract|body\.contractCode/)

  const combinedEndpoint = read('server/api/v1/finance/invoices/[code]/receipt-reconcile.post.ts')
  assert.match(combinedEndpoint, /data\.altocFinanceSummaryOperation/)
  assert.match(combinedEndpoint, /tryDispatchAltocFinanceSummaryOperation\(event, operationKey\)/)
  assert.doesNotMatch(combinedEndpoint, /syncAltocFinanceSummary/)
  assert.match(endpoint, /if \(altocSync\.pending\) setResponseStatus\(event, 202\)/)
  assert.match(combinedEndpoint, /if \(altocSync\.pending\) setResponseStatus\(event, 202\)/)
})

test('Finance Altoc executor freezes route, capability, receipt identity and retry checkpoints', () => {
  const executor = read('server/utils/altocFinanceSummaryOperation.ts')
  assert.match(executor, /finance\.reconciliation\.altoc-summary\.v1/)
  assert.match(executor, /altoc:contract:finance-summary:sync/)
  assert.match(executor, /buildServiceCommandEnvelope\(operation\)/)
  assert.match(executor, /targetBizType: 'contract_finance_summary'/)
  assert.match(executor, /validateServiceCommandReceipt/)
  assert.match(executor, /:succeed/)
  assert.match(executor, /:fail/)
  assert.match(executor, /HZY_FINANCE_INTEGRATION_OPERATIONS_ENABLED/)
  assert.match(executor, /if \(!financeIntegrationOperationsEnabled\(\)\)[\s\S]{0,180}requireFinanceScheduledRuntimeBinding\(\)/)
  assert.match(executor, /integration_dispatch_unavailable/)
  assert.match(executor, /maxWallTimeMs: options\.maxWallTimeMs \|\| 45_000/)
  assert.match(executor, /claimReserveMs: options\.claimReserveMs \|\| 25_000/)
})

test('Finance reliable operation schema is additive and keeps command and attempts durable', () => {
  const migration = read('docs/migrations/20260710_finance_integration_operations.sql')
  assert.match(migration, /CREATE TABLE IF NOT EXISTS integration_operation \(/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS integration_operation_attempt \(/)
  assert.match(migration, /command_json JSON NOT NULL/)
  assert.match(migration, /target_receipt_id CHAR\(36\)/)
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/)
})

test('Altoc applies the frozen summary command inside the target receipt transaction', () => {
  const target = read('../data-runtime/internal/apps/altoc/service_receivables.go')
  assert.match(target, /ReceiptCommandFromBody\([\s\S]*finance\.reconciliation\.altoc-summary\.v1[\s\S]*altoc:contract:finance-summary:sync/)
  assert.match(target, /TrustedContext\.SourceApp != "finance"/)
  assert.match(target, /repository\.Execute\([\s\S]*syncContractFinanceSummaryTx/)
  assert.match(target, /TargetBizType: "contract_finance_summary"/)
})
