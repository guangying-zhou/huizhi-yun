import assert from 'node:assert/strict'
import { test } from 'node:test'
import { executeClaimedCompanyWeeklySummaryOperation } from '../server/utils/companyWeeklySummaryOperationExecutor.ts'

const markdownSha256 = 'a'.repeat(64)
const operationKey = 'aims:company-weekly-summary:2026-W40:r1'
const operation = () => ({
  operationId: '550e8400-e29b-41d4-a716-446655440000', operationKey, tenantCode: 'C000001', deploymentCode: 'C000001-test-aims',
  sourceApp: 'aims', targetApp: 'codocs', operationCode: 'aims.company-weekly-summary.codocs-publish.v1',
  requiredCapability: 'codocs:company-weekly-summary:publish', idempotencyKey: operationKey, commandSchemaVersion: 'v1',
  commandSha256: 'b'.repeat(64), fencingToken: 3,
  command: { summaryVersionId: '7', revisionNo: '1', markdownSha256, periodKey: '2026-W40', title: 'W40', idempotencyKey: operationKey, recipientUids: [] }
})
const receipt = (extra: Record<string, unknown> = {}) => ({
  receiptId: '660e8400-e29b-41d4-a716-446655440000', receiptStatus: 'succeeded',
  operationId: operation().operationId, operationCode: operation().operationCode, idempotencyKey: operationKey,
  commandSchemaVersion: 'v1', commandSha256: 'b'.repeat(64), targetBizType: 'company_weekly_summary_document',
  targetBizCode: '2026-W40', responseSummarySha256: 'c'.repeat(64), idempotent: false, ...extra
})

function harness(codocsResponse: Record<string, unknown>) {
  const calls: Array<{ path: string, body: Record<string, unknown> }> = []
  const io = {
    callRuntime: async (path: string, body: Record<string, unknown>) => {
      calls.push({ path, body })
      if (path.endsWith(':publish-content')) return { summaryVersionId: '7', periodKey: '2026-W40', markdownSha256, markdownContent: '# W40' }
      return { ok: true }
    },
    callAltoc: async () => ({}),
    callCodocsCompanySummary: async () => codocsResponse
  }
  return { io: io as never, calls }
}

test('a complete Codocs receipt with document evidence is checkpointed as succeeded', async () => {
  const { io, calls } = harness(receipt({
    documentUuid: '72dddeaa-6f0f-4f03-bfcb-08139bb9c00e', documentVersionId: 11, documentVersionNum: 1,
    markdownSha256, documentUrl: 'https://oss.example/x.md', result: { documentUuid: 'ignored-nested' }
  }))
  const outcome = await executeClaimedCompanyWeeklySummaryOperation(operation() as never, io, operationKey)
  assert.equal(outcome.synced, true)
  const succeed = calls.find(call => call.path.endsWith(':succeed'))
  assert.ok(succeed, 'expected a :succeed checkpoint')
  assert.equal(succeed.body.targetReceiptId, receipt().receiptId)
  assert.equal(succeed.body.documentUuid, '72dddeaa-6f0f-4f03-bfcb-08139bb9c00e')
  assert.equal(succeed.body.documentVersionId, 11)
  assert.equal(succeed.body.documentVersionNum, 1)
  assert.equal(succeed.body.markdownSha256, markdownSha256)
  assert.equal(succeed.body.documentUrl, 'https://oss.example/x.md')
  assert.equal(calls.some(call => call.path.endsWith(':fail')), false)
})

test('a valid receipt without document evidence still fails closed as incomplete', async () => {
  for (const missing of [{}, { documentUuid: 'u', documentVersionId: 11, documentVersionNum: 1, markdownSha256: 'd'.repeat(64) }]) {
    const { io, calls } = harness(receipt(missing))
    const outcome = await executeClaimedCompanyWeeklySummaryOperation(operation() as never, io, operationKey)
    assert.equal(outcome.synced, false)
    assert.ok(calls.some(call => call.path.endsWith(':fail')))
    assert.equal(calls.some(call => call.path.endsWith(':succeed')), false)
  }
})

test('receipt identity fields cannot be overridden by unvalidated response fields', async () => {
  const { io, calls } = harness(receipt({
    documentUuid: 'u', documentVersionId: 11, documentVersionNum: 1, markdownSha256, targetBizCode: '2026-W41'
  }))
  const outcome = await executeClaimedCompanyWeeklySummaryOperation(operation() as never, io, operationKey)
  assert.equal(outcome.synced, false)
  assert.equal(calls.some(call => call.path.endsWith(':succeed')), false)
})
